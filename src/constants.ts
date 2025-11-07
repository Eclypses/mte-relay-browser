/**
 * This file contains constants used throughout the MTE Relay client.
 * This includes header names, cache keys, and error message-to-status-code
 * mappings. Centralizing these values makes configuration and maintenance easier.
 */

export const MTE_ENCODED_HEADERS_HEADER = "x-mte-relay-eh";
export const MTE_RELAY_HEADER = "x-mte-relay";

export const CACHE_KEYS = {
  ORIGIN_STATUS: "origin-status",
  CLIENT_ID: "client-id",
  PAIR_QUEUE: "pair-queue",
  MTE_STATE: "mte-state",
  INIT_PROMISE: "init-promise",
};

export const MTE_ERRORS = {
  "Repair is required.": 559,
  "State not found.": 560,
  "Failed to encode.": 561,
  "Failed to decode.": 562,
  "Failed to get state from encoder or decoder.": 563,
  "DRBG reseed is required.": 564,
  "MTE Status was not successful.": 565,
  "Invalid Client ID header.": 566,
  "Failed to save decoder stateId.": 567,
  "Failed to save encoder stateId.": 568,
  "Missing required header": 569,
} as const;
