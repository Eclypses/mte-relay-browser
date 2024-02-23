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
  MteKyber,
  MteKyberStatus,
  MteKyberStrength,
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
let finishEncryptBytes = 0;

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
  const mkeEncoder = getEncoderFromPool("MKE", mteWasm);
  finishEncryptBytes = (mkeEncoder as MteMkeEnc).encryptFinishBytes();
  returnEncoderToPool(mkeEncoder);
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
 *    - Encode empty string ""
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
  const currentState = await getEncDecState(options.id);
  if (!currentState) {
    throw new MteRelayError("State not found.", {
      stateId: options.id,
    });
  }
  const encoder = getEncoderFromPool(options.type, mteWasm);
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
      if (item.data.length === finishEncryptBytes && options.type === "MKE") {
        // skip decode - it's just the finishEncryptBytes, but no actual data
        continue;
      }
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
  const threshold = Number(
    String(encdec.getDrbgsReseedInterval(drbg)).substring(0, 15)
  );
  const counter = Number(String(encdec.getReseedCounter()).substring(0, 15));
  const reseedIsRequired = counter / threshold > 0.9;
  if (reseedIsRequired) {
    throw new MteRelayError("DRBG reseed is required.");
  }
}

export function getKyberInitiator() {
  const initiator = new MteKyber(mteWasm, MteKyberStrength.K512);
  const keyPair = initiator.createKeypair();
  if (keyPair.status !== MteKyberStatus.success) {
    throw new Error("Initiator: Failed to create the key pair.");
  }
  const publicKey = u8ToB64(keyPair.result1!);

  function decryptSecret(encryptedSecretB64: string) {
    const encryptedSecret = b64ToU8(encryptedSecretB64);
    const result = initiator.decryptSecret(encryptedSecret);
    if (result.status !== MteKyberStatus.success) {
      throw new Error("Failed to decrypt the secret.");
    }
    // const secret = u8ToB64(result.result1!);
    return result.result1!;
  }

  return {
    publicKey,
    decryptSecret,
  };
}

function u8ToB64(bytes: Uint8Array): string {
  const isBrowser = typeof window !== "undefined";
  if (isBrowser) {
    return btoa(String.fromCharCode.apply(null, bytes as unknown as number[]));
  }
  return Buffer.from(bytes).toString("base64");
}

function b64ToU8(base64: string): Uint8Array {
  const isBrowser = typeof window !== "undefined";
  if (isBrowser) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
  return new Uint8Array(Buffer.from(base64, "base64"));
}
