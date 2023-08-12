import {
  MteMkeEnc,
  MteMkeDec,
  MteWasm,
  MteBase,
  MteStatus,
  MteArrStatus,
  MteStrStatus,
} from "mte";
import { setItem, takeItem } from "./memory-cache";
import { MteRelayError } from "./errors";

let mteWasm: MteWasm;

const cache = {
  saveState: setItem,
  takeState: takeItem,
};

const encoderPool: MteMkeEnc[] = [];
const decoderPool: MteMkeDec[] = [];

// this should be overwritten by the initWasm function in index.js
let MAX_POOL_SIZE = 5;

export function setEncoderDecoderPoolSize(size: number) {
  MAX_POOL_SIZE = size;
}

// fill pools with default encoders/decoders
function fillPools() {
  while (encoderPool.length < MAX_POOL_SIZE) {
    encoderPool.push(MteMkeEnc.fromdefault(mteWasm));
  }
  while (decoderPool.length < MAX_POOL_SIZE) {
    decoderPool.push(MteMkeDec.fromdefault(mteWasm, 1000, -63));
  }
}

// get encoder from pool, or create a new default encoder if pool is empty
function getEncoderFromPool() {
  const encoder = encoderPool.pop();
  if (!encoder) {
    return MteMkeEnc.fromdefault(mteWasm);
  }
  return encoder;
}

// get decoder from pool, or create a new default decoder if pool is empty
function getDecoderFromPool() {
  const decoder = decoderPool.pop();
  if (!decoder) {
    return MteMkeDec.fromdefault(mteWasm, 1000, -63);
  }
  return decoder;
}

// return encoder to pool, or destruct if pool is full
function returnEncoderToPool(encoder: MteMkeEnc) {
  if (encoderPool.length < MAX_POOL_SIZE) {
    encoder.uninstantiate();
    return encoderPool.push(encoder);
  }
  return encoder.destruct();
}

// return decoder to pool, or destruct if pool is full
function returnDecoderToPool(decoder: MteMkeDec) {
  if (decoderPool.length < MAX_POOL_SIZE) {
    decoder.uninstantiate();
    return decoderPool.push(decoder);
  }
  return decoder.destruct();
}

const pairIdQueueMap: Map<string, string[]> = new Map();

// add id to queue
function addPairIdToQueue(options: { serverId: string; pairId: string }) {
  let pairIds = pairIdQueueMap.get(options.serverId);
  if (!pairIds) {
    pairIds = [];
    pairIdQueueMap.set(options.serverId, pairIds);
  }
  pairIds.push(options.pairId);
}

// get next id from queue
export function getNextPairIdFromQueue(serverId: string) {
  const pairIds = pairIdQueueMap.get(serverId) || [];
  const id = pairIds.shift();
  if (!id) {
    throw Error("No ID in queue.");
  }
  pairIds.push(id);
  return id;
}

// delete an ID from the queue
export function deleteIdFromQueue(options: {
  serverId: string;
  pairId: string;
}) {
  const pairIds = pairIdQueueMap.get(options.serverId);
  if (!pairIds) {
    throw Error("No queue for server.");
  }
  const index = pairIds.indexOf(options.pairId);
  if (index === -1) {
    throw Error("ID not found in queue.");
  }
  pairIds.splice(index, 1);
}

// init MteWasm
// update cache with custom save/take state methods (if provided)
// fill pools
export async function instantiateMteWasm(options: {
  licenseKey: string;
  companyName: string;
  saveState?: (id: string, value: string) => Promise<void>;
  takeState?: (id: string) => Promise<string | null>;
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
  if (options.saveState) {
    cache.saveState = options.saveState;
  }
  if (options.takeState) {
    cache.takeState = options.takeState;
  }
  fillPools();
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
  serverId: string;
  pairId: string;
  entropy: Uint8Array;
  nonce: string;
  personalization: string;
}) {
  const encoder = getEncoderFromPool();
  encoder.setEntropyArr(options.entropy);
  encoder.setNonce(options.nonce);
  const initResult = encoder.instantiate(options.personalization);
  validateStatusIsSuccess(initResult, encoder);
  const state = getMteState(encoder);
  await cache.saveState(`encoder.${options.serverId}.${options.pairId}`, state);
  returnEncoderToPool(encoder);
  addPairIdToQueue({
    serverId: options.serverId,
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
  serverId: string;
  pairId: string;
  entropy: Uint8Array;
  nonce: string;
  personalization: string;
}) {
  const decoder = getDecoderFromPool();
  decoder.setEntropyArr(options.entropy);
  decoder.setNonce(options.nonce);
  const initResult = decoder.instantiate(options.personalization);
  validateStatusIsSuccess(initResult, decoder);
  const state = getMteState(decoder);
  returnDecoderToPool(decoder);
  await cache.saveState(`decoder.${options.serverId}.${options.pairId}`, state);
}

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
export async function mkeEncode(
  payload: string | Uint8Array,
  options: { id: string; output: "B64" | "Uint8Array" }
) {
  const encoder = getEncoderFromPool();
  const currentState = await cache.takeState(options.id);
  if (!currentState) {
    returnEncoderToPool(encoder);
    throw new MteRelayError("State not found.", {
      stateId: options.id,
    });
  }
  restoreMteState(encoder, currentState);
  const nextStateResult = encoder.encodeStr("\0");
  validateStatusIsSuccess(nextStateResult.status, encoder);
  const nextState = getMteState(encoder);
  await cache.saveState(options.id, nextState);
  restoreMteState(encoder, currentState);
  let encodeResult: MteArrStatus | MteStrStatus;
  try {
    if (payload instanceof Uint8Array) {
      if (options.output === "Uint8Array") {
        encodeResult = encoder.encode(payload);
      } else {
        encodeResult = encoder.encodeB64(payload);
      }
    } else {
      if (options.output === "Uint8Array") {
        encodeResult = encoder.encodeStr(payload);
      } else {
        encodeResult = encoder.encodeStrB64(payload);
      }
    }
    validateStatusIsSuccess(encodeResult.status, encoder);
  } catch (error) {
    throw new MteRelayError("Failed to encode.", {
      stateId: options.id,
      error: (error as Error).message,
    });
  }
  returnEncoderToPool(encoder);
  return "str" in encodeResult ? encodeResult.str : encodeResult.arr;
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
export async function mkeDecode(
  payload: string | Uint8Array,
  options: { id: string; output: "str" | "Uint8Array" }
) {
  const currentState = await cache.takeState(options.id);
  if (!currentState) {
    throw new MteRelayError("State not found.", {
      stateId: options.id,
    });
  }
  const decoder = getDecoderFromPool();
  restoreMteState(decoder, currentState);
  drbgReseedCheck(decoder);
  let decodeResult: MteArrStatus | MteStrStatus;
  try {
    if (payload instanceof Uint8Array) {
      if (options.output === "Uint8Array") {
        decodeResult = decoder.decode(payload);
      } else {
        decodeResult = decoder.decodeStr(payload);
      }
    } else {
      if (options.output === "Uint8Array") {
        decodeResult = decoder.decodeB64(payload);
      } else {
        decodeResult = decoder.decodeStrB64(payload);
      }
    }
    validateStatusIsSuccess(decodeResult.status, decoder);
  } catch (error) {
    throw new MteRelayError("Failed to decode.", {
      stateId: options.id,
      error: (error as Error).message,
    });
  }
  const state = getMteState(decoder);
  returnDecoderToPool(decoder);
  await cache.saveState(options.id, state);
  return "str" in decodeResult ? decodeResult.str : decodeResult.arr;
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

// restore state to any encoder or decoder
type EncDec = MteMkeEnc | MteMkeDec;
function restoreMteState(encdec: EncDec, state: string): void {
  const result = encdec.restoreStateB64(state);
  validateStatusIsSuccess(result, encdec);
}

// Gets state from any encoder or decoder
function getMteState(encoder: EncDec) {
  const state = encoder.saveStateB64();
  if (!state) {
    throw new MteRelayError("Failed to get state from encoder or decoder.");
  }
  return state;
}

// Checks if DRBG reseed is required for any encoder or decoder
function drbgReseedCheck(encoder: EncDec) {
  const drbg = encoder.getDrbg();
  const threshhold = Number(
    String(encoder.getDrbgsReseedInterval(drbg)).substring(0, 15)
  );
  const counter = Number(String(encoder.getReseedCounter()).substring(0, 15));
  const reseedIsRequired = counter / threshhold > 0.9;
  if (reseedIsRequired) {
    throw new MteRelayError("DRBG reseed is required.");
  }
}
