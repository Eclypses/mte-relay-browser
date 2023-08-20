const MTE_ERRORS = {
  "Repair is required.": 559,
  "State not found.": 560,
  "Failed to encode.": 561,
  "Failed to decode.": 562,
  "Failed to get state from encoder or decoder.": 563,
  "DRBG reseed is required.": 564,
  "MTE Status was not successful.": 565,
  "Invalid Client ID header.": 566,
} as const;

const statusCodes: Set<number> = new Set(Object.values(MTE_ERRORS));

type ErrorMessages = keyof typeof MTE_ERRORS;

export class MteRelayError extends Error {
  public status: number;
  public info?: any;

  constructor(message: ErrorMessages, info?: any) {
    super(message);
    this.status = MTE_ERRORS[message];
    this.info = info;
  }

  static isMteErrorStatus(status: number) {
    return statusCodes.has(status);
  }
  static getStatusErrorMessages(status: number): ErrorMessages | undefined {
    const entries = Object.entries(MTE_ERRORS);
    for (const [message, code] of entries) {
      if (code === status) {
        return message as ErrorMessages;
      }
    }
    return undefined;
  }
}
