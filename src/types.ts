/**
 * This file contains shared TypeScript types and interfaces used throughout the
 * MTE Relay client library. Centralizing these types helps maintain consistency
 * and improves code clarity.
 */

import { MteDec, MteEnc, MteMkeDec, MteMkeEnc } from "mte";

/**
 * Interface for persistent storage. Allows for custom implementations
 * in different environments (e.g., localStorage in browser, file system in Node).
 */
export interface MteRelayStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

/**
 * Configuration options for initializing the MTE Relay Client.
 */
export interface MteRelayClientOptions {
  licenseKey: string;
  licenseCompany: string;
  numberOfPairs?: number;
  mtePoolSize?: number;
  mkePoolSize?: number;
  encodeType?: "MTE" | "MKE";
  encodeUrls?: boolean;
  encodeHeaders?: boolean | string[];
  pathPrefix?: string;
  storage?: MteRelayStorage;
  fetch?: typeof fetch;
}

/**
 * Per-request options to override the default MTE encoding behavior.
 */
export interface MteRequestOptions {
  encodeUrl: boolean;
  encodeHeaders: boolean | string[];
  encodeType: "MTE" | "MKE";
  useStreaming: boolean;
  pathPrefix: string;
}

/**
 * Represents the parsed data from the x-mte-relay header.
 */
export interface MteRelayHeader {
  clientId: string;
  pairId: string;
  type: "MTE" | "MKE";
  urlIsEncoded: boolean;
  headersAreEncoded: boolean;
  bodyIsEncoded: boolean;
  useStreaming: boolean;
}

/**
 * The possible validation and pairing statuses for a given origin.
 */
export type OriginStatus = "paired" | "invalid" | "validate" | "pending";

/**
 * A union type representing any of the possible MTE encoder or decoder instances.
 */
export type EncDec = MteMkeEnc | MteMkeDec | MteEnc | MteDec;

/**
 * A union type representing the two supported encoding types.
 */
export type EncDecTypes = "MTE" | "MKE";
