/**
 * This file contains functions for managing the MTE lifecycle, including WASM
 * initialization, encoder/decoder instantiation, and object pooling. These
 * helpers abstract the low-level details of interacting with the MTE Core library.
 */

import {
  MteBase,
  MteDec,
  MteEnc,
  MteMkeDec,
  MteMkeEnc,
  MteStatus,
  MteWasm,
} from "mte";
import {
  config,
  isTrial,
  mteWasm,
  setFinishEncryptBytes,
  setIsTrial,
  setMteWasm,
} from "./config";
import { addPairIdToQueue, setEncDecState } from "./cache";
import { validateStatusIsSuccess } from "./utils";
import type { EncDec } from "./types";
import { getMteState } from "./mte-state";

const pools = {
  mte: {
    encoder: [] as MteEnc[],
    decoder: [] as MteDec[],
  },
  mke: {
    encoder: [] as MteMkeEnc[],
    decoder: [] as MteMkeDec[],
  },
};

/**
 * Initializes the MTE WASM module and validates the license.
 * @param options License information.
 */
export async function initWasm(options: {
  licenseKey: string;
  companyName: string;
}) {
  if (mteWasm) return;

  const wasm = new MteWasm();
  await wasm.instantiate();
  setMteWasm(wasm);

  const mteBase = new MteBase(mteWasm);
  if (!mteBase.initLicense(options.companyName, options.licenseKey)) {
    const status = mteBase.getStatusName(MteStatus.mte_status_license_error);
    const message = mteBase.getStatusDescription(
      MteStatus.mte_status_license_error
    );
    throw new Error(`Error with MTE License.\n${status}: ${message}`);
  }

  fillEncDecPools();

  const mkeEncoder = getPoolItem("MKE", "encoder");
  setFinishEncryptBytes((mkeEncoder as MteMkeEnc).encryptFinishBytes());
  returnPoolItem(mkeEncoder);

  const drbg = mteBase.getDefaultDrbg();
  const isTrialMode = mteBase.getDrbgsEntropyMinBytes(drbg) === 0;
  setIsTrial(isTrialMode);
  if (isTrialMode) {
    console.warn(
      "MTE Trial Build is detected! It offers no security guarantees."
    );
  }
}

/**
 * Populates the encoder and decoder pools with new MTE instances.
 */
function fillEncDecPools() {
  for (let i = 0; i < config.mtePoolSize; ++i) {
    pools.mte.encoder.push(MteEnc.fromdefault(mteWasm));
    pools.mte.decoder.push(MteDec.fromdefault(mteWasm, 1000, -63));
  }
  for (let i = 0; i < config.mkePoolSize; ++i) {
    pools.mke.encoder.push(MteMkeEnc.fromdefault(mteWasm));
    pools.mke.decoder.push(MteMkeDec.fromdefault(mteWasm, 1000, -63));
  }
}

/**
 * Retrieves an encoder or decoder instance from the appropriate pool.
 * @param type The type of instance ("MTE" or "MKE").
 * @param role The role of the instance ("encoder" or "decoder").
 * @returns An MTE instance.
 */
export function getPoolItem(
  type: "MTE" | "MKE",
  role: "encoder"
): MteEnc | MteMkeEnc;
export function getPoolItem(
  type: "MTE" | "MKE",
  role: "decoder"
): MteDec | MteMkeDec;
export function getPoolItem(
  type: "MTE" | "MKE",
  role: "encoder" | "decoder"
): MteEnc | MteMkeEnc | MteDec | MteMkeDec {
  const pool = pools[type.toLowerCase() as "mte" | "mke"][role];
  if (pool.length > 0) {
    return pool.pop()!;
  }
  if (type === "MTE") {
    return role === "encoder"
      ? MteEnc.fromdefault(mteWasm)
      : MteDec.fromdefault(mteWasm, 1000, -63);
  }
  return role === "encoder"
    ? MteMkeEnc.fromdefault(mteWasm)
    : MteMkeDec.fromdefault(mteWasm, 1000, -63);
}

/**
 * Returns an MTE instance to its pool for reuse.
 * @param {EncDec} item The MTE instance to return.
 */
export function returnPoolItem(item: EncDec) {
  item.uninstantiate();
  if (item instanceof MteEnc && pools.mte.encoder.length < config.mtePoolSize) {
    pools.mte.encoder.push(item);
  } else if (
    item instanceof MteDec &&
    pools.mte.decoder.length < config.mtePoolSize
  ) {
    pools.mte.decoder.push(item);
  } else if (
    item instanceof MteMkeEnc &&
    pools.mke.encoder.length < config.mkePoolSize
  ) {
    pools.mke.encoder.push(item);
  } else if (
    item instanceof MteMkeDec &&
    pools.mke.decoder.length < config.mkePoolSize
  ) {
    pools.mke.decoder.push(item);
  } else {
    item.destruct();
  }
}

/**
 * Creates and initializes a new MTE encoder instance.
 * @param options Configuration for the new encoder.
 */
export async function instantiateEncoder(options: {
  origin: string;
  pairId: string;
  entropy: Uint8Array;
  nonce: string;
  personalization: string;
}) {
  const encoder = getPoolItem("MTE", "encoder");
  encoder.setEntropyArr(isTrial ? new Uint8Array(0) : options.entropy);
  encoder.setNonce(options.nonce);
  const initResult = encoder.instantiate(options.personalization);
  validateStatusIsSuccess(initResult, encoder);
  const state = getMteState(encoder);
  returnPoolItem(encoder);
  setEncDecState(`encoder.${options.origin}.${options.pairId}`, state);
  addPairIdToQueue(options.origin, options.pairId);
}

/**
 * Creates and initializes a new MTE decoder instance.
 * @param options Configuration for the new decoder.
 */
export async function instantiateDecoder(options: {
  origin: string;
  pairId: string;
  entropy: Uint8Array;
  nonce: string;
  personalization: string;
}) {
  const decoder = getPoolItem("MTE", "decoder");
  decoder.setEntropyArr(isTrial ? new Uint8Array(0) : options.entropy);
  decoder.setNonce(options.nonce);
  const initResult = decoder.instantiate(options.personalization);
  validateStatusIsSuccess(initResult, decoder);
  const state = getMteState(decoder);
  returnPoolItem(decoder);
  setEncDecState(`decoder.${options.origin}.${options.pairId}`, state);
}
