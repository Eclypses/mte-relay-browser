/**
 * This file contains utility functions for cryptography, data encoding,
 * header manipulation, and MTE status validation. These helpers are used
 * across different modules to perform common tasks.
 */

import {
  MteBase,
  MteKyber,
  MteKyberStatus,
  MteKyberStrength,
  MteStatus,
} from "mte";
import { mteWasm } from "./config";
import { MteRelayError } from "./errors";
import type { EncDec, MteRelayHeader } from "./types";

/**
 * Creates a Kyber initiator instance for PQC key exchange.
 * @returns An object with the public key and a function to decrypt the secret.
 */
export function getKyberInitiator() {
  const initiator = new MteKyber(mteWasm, MteKyberStrength.K512);
  const keyPair = initiator.createKeypair();
  if (keyPair.status !== MteKyberStatus.success) {
    throw new Error("Kyber initiator failed to create key pair.");
  }
  const publicKey = u8ToB64(keyPair.result1!);

  function decryptSecret(encryptedSecretB64: string): Uint8Array {
    const encryptedSecret = b64ToU8(encryptedSecretB64);
    const result = initiator.decryptSecret(encryptedSecret);
    if (result.status !== MteKyberStatus.success) {
      throw new Error("Kyber initiator failed to decrypt secret.");
    }
    return result.result1!;
  }

  return { publicKey, decryptSecret };
}

const HEX_CHARS = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, "0")
);

/**
 * Generates a cryptographically random 16-byte hex string.
 * @returns {string} A random hex string.
 */
export function getRandomStr(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);

  let s = "";
  for (let i = 0; i < array.length; i++) {
    s += HEX_CHARS[array[i]];
  }
  return s;
}

/**
 * Converts a Uint8Array to a Base64 string.
 * @param {Uint8Array} bytes The byte array to convert.
 * @returns {string} The Base64 encoded string.
 */
export function u8ToB64(bytes: Uint8Array): string {
  const isBrowser = typeof window !== "undefined";
  return isBrowser
    ? btoa(String.fromCharCode.apply(null, bytes as unknown as number[]))
    : Buffer.from(bytes).toString("base64");
}

/**
 * Converts a Base64 string to a Uint8Array.
 * @param {string} base64 The Base64 string to convert.
 * @returns {Uint8Array} The decoded byte array.
 */
export function b64ToU8(base64: string): Uint8Array {
  const isBrowser = typeof window !== "undefined";
  const binaryString = isBrowser
    ? atob(base64)
    : Buffer.from(base64, "base64").toString("binary");
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Formats the MTE Relay header object into a comma-separated string.
 * @param {MteRelayHeader} options The header data.
 * @returns {string} The formatted header string.
 */
export function formatMteRelayHeader(options: MteRelayHeader): string {
  return [
    options.clientId,
    options.pairId,
    options.type === "MTE" ? 0 : 1,
    options.urlIsEncoded ? 1 : 0,
    options.headersAreEncoded ? 1 : 0,
    options.bodyIsEncoded ? 1 : 0,
    options.useStreaming ? 1 : 0,
  ].join(",");
}

/**
 * Parses a comma-separated MTE Relay header string into an object.
 * @param {string} header The header string.
 * @returns {MteRelayHeader} The parsed header data.
 */
export function parseMteRelayHeader(header: string): MteRelayHeader {
  const args = header.split(",");
  return {
    clientId: args[0],
    pairId: args[1],
    type: args[2] === "0" ? "MTE" : "MKE",
    urlIsEncoded: args[3] === "1",
    headersAreEncoded: args[4] === "1",
    bodyIsEncoded: args[5] === "1",
    useStreaming: args[6] === "1",
  };
}

/**
 * Validates that an MTE operation status is successful, throwing an error if not.
 * @param {MteStatus} status The status returned from an MTE operation.
 * @param {MteBase} mteBase The MTE instance used, for error reporting.
 */
export function validateStatusIsSuccess(status: MteStatus, mteBase: MteBase) {
  if (
    status !== MteStatus.mte_status_success &&
    mteBase.statusIsError(status)
  ) {
    throw new MteRelayError("MTE Status was not successful.", {
      statusName: mteBase.getStatusName(status),
      description: mteBase.getStatusDescription(status),
    });
  }
}

/**
 * Checks if the DRBG reseed counter is approaching its threshold.
 * @param {EncDec} encdec The encoder or decoder instance.
 */
let __threshold = 0;
export function drbgReseedCheck(encdec: EncDec): void {
  if (__threshold === 0) {
    const drbg = encdec.getDrbg();
    __threshold = Number(
      String(encdec.getDrbgsReseedInterval(drbg)).substring(0, 15)
    );
  }
  const counter = Number(String(encdec.getReseedCounter()).substring(0, 15));
  if (counter / __threshold > 0.9) {
    throw new MteRelayError("DRBG reseed is required.");
  }
}
