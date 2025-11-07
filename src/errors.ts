/**
 * This file defines a custom error class, MteRelayError, for handling
 * specific errors that can occur during MTE Relay operations. It provides
 * a structured way to manage server-side MTE errors and other client-side
 * exceptions.
 */

import { MTE_ERRORS } from "./constants";

const statusCodes: Set<number> = new Set(Object.values(MTE_ERRORS));
type ErrorMessages = keyof typeof MTE_ERRORS;

/**
 * Custom error class for MTE Relay specific issues.
 */
export class MteRelayError extends Error {
  public status: number;
  public info?: Record<string, any>;

  constructor(message: ErrorMessages, info?: Record<string, any>) {
    super(message);
    this.status = info?.status || MTE_ERRORS[message];
    this.info = info;
  }

  /**
   * Checks if a given HTTP status code corresponds to a known MTE Relay error.
   * @param {number} status The HTTP status code.
   * @returns {boolean} True if it is a known MTE error status.
   */
  static isMteErrorStatus(status: number): boolean {
    return statusCodes.has(status);
  }

  /**
   * Retrieves the error message associated with a given MTE Relay status code.
   * @param {number} status The HTTP status code.
   * @returns {ErrorMessages | undefined} The corresponding error message.
   */
  static getStatusErrorMessages(status: number): ErrorMessages | undefined {
    for (const [message, code] of Object.entries(MTE_ERRORS)) {
      if (code === status) return message as ErrorMessages;
    }
    return undefined;
  }
}
