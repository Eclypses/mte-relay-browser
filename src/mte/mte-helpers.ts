import {
  MteEnc,
  MteDec,
  MteMkeEnc,
  MteMkeDec,
  MteWasm,
  MteBase,
  MteStatus,
  MteArrStatus,
  MteStrStatus,
} from "mte";
import {
  RemoteRecord,
  addPairIdToQueue,
  getEncDecState,
  setCacheFunction,
  setEncDecState,
} from "./cache";
import { MteRelayError } from "./errors";
import {
  fillEncDecPools,
  getDecoderFromPool,
  getEncoderFromPool,
  returnDecoderToPool,
  returnEncoderToPool,
} from "./encoder-decoder-pools";

let mteWasm: MteWasm;

// init MteWasm
// update cache with custom save/take state methods (if provided)
// fill pools
export async function instantiateMteWasm(options: {
  licenseKey: string;
  companyName: string;
  saveState?: (key: string, value: RemoteRecord | string) => Promise<void>;
  takeState?: (key: string) => Promise<string | RemoteRecord | undefined>;
  mkePoolSize?: number;
  mtePoolSize?: number;
}) {
  if (mteWasm) {
    return;
  }
  mteWasm = new MteWasm();
  await mteWasm.instantiate();
  const mteBase = new MteBase(mteWasm);
  const initResult = mteBase.initLicense(
    options.companyName,
    options.licenseKey
  );
  if (!initResult) {
    const licenseStatus = MteStatus.mte_status_license_error;
    const status = mteBase.getStatusName(licenseStatus);
    const message = mteBase.getStatusDescription(licenseStatus);
    throw new Error(`Error with MTE License.\n${status}: ${message}`);
  }
  if (options.saveState && options.takeState) {
    setCacheFunction(options.takeState, options.saveState);
  }
  fillEncDecPools({
    mteWasm,

    mkePoolSize: options.mkePoolSize,
    mtePoolSize: options.mtePoolSize,
  });
}

/**
 * Create new MKE Encoder
 * - Get encoder from pool
 * - Instantiate encoder with entropy, nonce, personalization
 * - validate status is success
 * - get state from encoder
 * - return encoder to pool
 * - save state to cache
 */
export async function instantiateEncoder(options: {
  origin: string;
  pairId: string;
  entropy: Uint8Array;
  nonce: string;
  personalization: string;
}) {
  const encoder = getEncoderFromPool("MTE", mteWasm);
  encoder.setEntropyArr(options.entropy);
  encoder.setNonce(options.nonce);
  const initResult = encoder.instantiate(options.personalization);
  validateStatusIsSuccess(initResult, encoder);
  const state = getMteState(encoder);
  returnEncoderToPool(encoder);
  await setEncDecState(`encoder.${options.origin}.${options.pairId}`, state);
  await addPairIdToQueue({
    origin: options.origin,
    pairId: options.pairId,
  });
}

/**
 * Create new MKE Decoder
 * - Get decoder from pool
 * - Instantiate decoder with entropy, nonce, personalization
 * - validate status is success
 * - get state from decoder
 * - return decoder to pool
 * - save state to cache
 */
export async function instantiateDecoder(options: {
  origin: string;
  pairId: string;
  entropy: Uint8Array;
  nonce: string;
  personalization: string;
}) {
  const decoder = getDecoderFromPool("MTE", mteWasm);
  decoder.setEntropyArr(options.entropy);
  decoder.setNonce(options.nonce);
  const initResult = decoder.instantiate(options.personalization);
  validateStatusIsSuccess(initResult, decoder);
  const state = getMteState(decoder);
  returnDecoderToPool(decoder);
  await setEncDecState(`decoder.${options.origin}.${options.pairId}`, state);
}

type EncDecTypes = "MTE" | "MKE";

/**
 * MKE Encode a payload
 * - Get state from cache
 * - Get encoder from pool
 * - Restore state to encoder
 * - Perform Next State Generation trick
 *    - Encode "eclypses"
 *    - Save "next" state to cache
 *    - Restore Encoder to original state (from first step)
 * - Encode payload
 * - return encoder to pool
 * - return encoded value
 */
export async function encode(options: {
  id: string;
  type: EncDecTypes;
  items: {
    data: string | Uint8Array;
    output: "B64" | "Uint8Array";
  }[];
}) {
  const encoder = getEncoderFromPool(options.type, mteWasm);
  const currentState = await getEncDecState(options.id);
  if (!currentState) {
    returnEncoderToPool(encoder);
    throw new MteRelayError("State not found.", {
      stateId: options.id,
    });
  }
  restoreMteState(encoder, currentState);
  // nextState generation + save nextState in cache
  if (options.type === "MKE") {
    let nextStateResult: MteStatus = 0;
    let i = 0;
    const iMax = options.items.length;
    for (; i < iMax; ++i) {
      nextStateResult = encoder.encodeStr("").status;
    }
    validateStatusIsSuccess(nextStateResult, encoder);
    const nextState = getMteState(encoder);
    await setEncDecState(options.id, nextState);
    restoreMteState(encoder, currentState);
  }
  let encodeResults: (String | Uint8Array)[] = [];
  try {
    for (const item of options.items) {
      let encodeResult: MteArrStatus | MteStrStatus;
      if (item.data instanceof Uint8Array) {
        if (item.output === "Uint8Array") {
          encodeResult = encoder.encode(item.data);
        } else {
          encodeResult = encoder.encodeB64(item.data);
        }
      } else {
        if (item.output === "Uint8Array") {
          encodeResult = encoder.encodeStr(item.data);
        } else {
          encodeResult = encoder.encodeStrB64(item.data);
        }
      }
      validateStatusIsSuccess(encodeResult.status, encoder);
      encodeResults.push(
        "str" in encodeResult ? encodeResult.str! : encodeResult.arr!
      );
    }
  } catch (error) {
    returnEncoderToPool(encoder);
    throw new MteRelayError("Failed to encode.", {
      stateId: options.id,
      error: (error as Error).message,
    });
  }
  if (options.type === "MTE") {
    const state = getMteState(encoder);
    await setEncDecState(options.id, state);
  }
  returnEncoderToPool(encoder);
  return encodeResults;
}

/**
 * Decode an MKE Payload
 * - Get state from cache
 * - Get decoder from pool
 * - Restore state to decoder
 * - Decode payload
 * - Get state from decoder
 * - Return decoder to pool
 * - Save state to cache
 * - Return decoded value
 */
export async function decode(options: {
  id: string;
  type: EncDecTypes;
  items: {
    data: string | Uint8Array;
    output: "str" | "Uint8Array";
  }[];
}) {
  const currentState = await getEncDecState(options.id);
  if (!currentState) {
    throw new MteRelayError("State not found.", {
      stateId: options.id,
    });
  }
  const decoder = getDecoderFromPool(options.type, mteWasm);
  restoreMteState(decoder, currentState);
  drbgReseedCheck(decoder);
  const decodeResults: (String | Uint8Array)[] = [];
  try {
    for (const item of options.items) {
      let decodeResult: MteArrStatus | MteStrStatus;
      if (item.data instanceof Uint8Array) {
        if (item.output === "Uint8Array") {
          decodeResult = decoder.decode(item.data);
        } else {
          decodeResult = decoder.decodeStr(item.data);
        }
      } else {
        if (item.output === "Uint8Array") {
          decodeResult = decoder.decodeB64(item.data);
        } else {
          decodeResult = decoder.decodeStrB64(item.data);
        }
      }
      validateStatusIsSuccess(decodeResult.status, decoder);
      decodeResults.push(
        "str" in decodeResult ? decodeResult.str! : decodeResult.arr!
      );
    }
  } catch (error) {
    returnDecoderToPool(decoder);
    throw new MteRelayError("Failed to decode.", {
      stateId: options.id,
      error: (error as Error).message,
    });
  }
  const state = getMteState(decoder);
  returnDecoderToPool(decoder);
  await setEncDecState(options.id, state);
  return decodeResults;
}

/**
 * Use Mke Chunking mode to start a session and chunk all data. Call finishEncrypt() to end session.
 *
 * @param {string} stateId - The ID of the state to use for encoding.
 * @returns An object containing functions to encode data in chunks and finish the encoding process.
 *
 * @throws {MteRelayError} Throws an error if the state specified by stateId is not found.
 *
 * @example
 * const { encodeChunk, finishEncrypt } = await mkeEncodeChunks("stateId");
 * let decoded = encodeChunk(x);
 * decoded = encodeChunk(x);
 * finishEncrypt();
 */

export async function encodeChunks(stateId: string) {
  const encoder = getEncoderFromPool("MKE", mteWasm) as MteMkeEnc;
  const currentState = await getEncDecState(stateId);
  if (!currentState) {
    throw new MteRelayError("State not found.", { stateId });
  }
  restoreMteState(encoder, currentState);

  // nextState generation + save nextState in cache
  const nextStateResult = encoder.encodeStr("");
  validateStatusIsSuccess(nextStateResult.status, encoder);
  const nextState = getMteState(encoder);
  setEncDecState(stateId, nextState).catch((error) => {
    throw new MteRelayError("Failed to save encoder stateId.", {
      stateId,
      error: (error as Error).message,
    });
  });
  restoreMteState(encoder, currentState);

  encoder.startEncrypt();

  function finishEncrypt() {
    const result = encoder.finishEncrypt();
    validateStatusIsSuccess(result.status, encoder);
    returnEncoderToPool(encoder);
  }

  return {
    encodeChunk: encoder.encryptChunk,
    finishEncrypt,
  };
}

/**
 * Use Mke Chunking mode to start a session and chunk all data. Call finishDecrypt() to end session.
 *
 * @param {string} stateId - The ID of the state to use for encoding.
 * @returns An object containing functions to encode data in chunks and finish the encoding process.
 *
 * @throws {MteRelayError} Throws an error if the state specified by stateId is not found.
 *
 * @example
 * const { decodeChunk, finishDecrypt } = await mkeDecodeChunks("stateId");
 * let decoded = decodeChunk(x);
 * decoded = decodeChunk(x);
 * finishDecrypt();
 *
 */
export async function decodeChunks(stateId: string) {
  const decoder = getDecoderFromPool("MKE", mteWasm) as MteMkeDec;
  const currentState = await getEncDecState(stateId);
  if (!currentState) {
    throw new MteRelayError("State not found.", {
      stateId: stateId,
    });
  }
  restoreMteState(decoder, currentState);
  drbgReseedCheck(decoder);

  decoder.startDecrypt();

  async function finishDecrypt() {
    const result = decoder.finishDecrypt();
    validateStatusIsSuccess(result.status, decoder);
    const nextState = getMteState(decoder);
    setEncDecState(stateId, nextState).catch((error) => {
      throw new MteRelayError("Failed to save encoder stateId.", {
        stateId,
        error: (error as Error).message,
      });
    });
    returnDecoderToPool(decoder);
  }

  return {
    decodeChunk: decoder.decryptChunk,
    finishDecrypt,
  };
}

// Validate MteStatus is successful
// Note: Encoders/Decoders inherit from MteBase, so they are valid as the 2nd argument
function validateStatusIsSuccess(status: MteStatus, mteBase: MteBase) {
  if (status !== MteStatus.mte_status_success) {
    const isError = mteBase.statusIsError(status);
    if (isError) {
      const statusName = mteBase.getStatusName(status);
      const description = mteBase.getStatusDescription(status);
      throw new MteRelayError("MTE Status was not successful.", {
        statusName,
        description,
      });
    }
  }
}

// Gets state from any encoder or decoder
function getMteState(encdec: EncDec) {
  const state = encdec.saveStateB64();
  if (!state) {
    throw new MteRelayError("Failed to get state from encoder or decoder.");
  }
  return state;
}

// restore state to any encoder or decoder
type EncDec = MteMkeEnc | MteMkeDec | MteEnc | MteDec;
function restoreMteState(encdec: EncDec, state: string): void {
  const result = encdec.restoreStateB64(state);
  validateStatusIsSuccess(result, encdec);
}

// Checks if DRBG reseed is required for any encoder or decoder
function drbgReseedCheck(encdec: EncDec) {
  const drbg = encdec.getDrbg();
  const threshhold = Number(
    String(encdec.getDrbgsReseedInterval(drbg)).substring(0, 15)
  );
  const counter = Number(String(encdec.getReseedCounter()).substring(0, 15));
  const reseedIsRequired = counter / threshhold > 0.9;
  if (reseedIsRequired) {
    throw new MteRelayError("DRBG reseed is required.");
  }
}