/**
 * This file contains functions for managing the saving and restoring of MTE
 * encoder and decoder states. This is crucial for stateless operations and
 * for persisting MTE sessions across requests.
 */

import { MteRelayError } from "./errors";
import { validateStatusIsSuccess } from "./utils";
import type { EncDec } from "./types";

/**
 * Saves the current state of an MTE instance to a Base64 string.
 * @param {EncDec} encdec The MTE instance.
 * @returns {string} The Base64 encoded state.
 */
export function getMteState(encdec: EncDec): string {
  const state = encdec.saveStateB64();
  if (!state) {
    throw new MteRelayError("Failed to get state from encoder or decoder.");
  }
  return state;
}

/**
 * Restores an MTE instance's state from a Base64 string.
 * @param {EncDec} encdec The MTE instance.
 * @param {string} state The Base64 encoded state to restore.
 */
export function restoreMteState(encdec: EncDec, state: string): void {
  const result = encdec.restoreStateB64(state);
  validateStatusIsSuccess(result, encdec);
}
