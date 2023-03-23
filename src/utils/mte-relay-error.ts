// define error messages and codes for MTE Relay
const MTE_RELAY_ERROR_CODES = {
  "Origin is not an MTE Relay origin.": 550,
  "Failed to pair with server MTE Translator.": 551,
  "Unknown value to encode.": 552,
} as const;

// prevent changes to this object
Object.freeze(MTE_RELAY_ERROR_CODES);

// a type of just the error messages
type ERROR_KEYS = keyof typeof MTE_RELAY_ERROR_CODES;

/**
 * An error class for MTE Relay errors.
 * @param {string} message The error message.
 * @return An error object with a message and statusCode property.
 */
export class MteRelayError extends Error {
  constructor(message: ERROR_KEYS) {
    super(message);
    this.statusCode = MTE_RELAY_ERROR_CODES[message];
  }
  statusCode: number;
}
