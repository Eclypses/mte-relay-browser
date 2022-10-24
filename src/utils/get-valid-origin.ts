// regex to identify origin scheme:hostname[:port]
const originRegex = /^[\w-]+:\/*\[?[\p{L}\d\\.:_-]+\]?(?::\d*)?/u;
/**
 * Takes in a string and returns the origin, or throws an error if no origin is found.
 * @param origin A string that include an origin or type: scheme:host[:port]
 * @returns A string of the origin.
 *
 * ```js
 * getValidOrigin("https://eclypses.com/mte-technology/website-security/");
 * // returns "https://eclypses.com"
 * ```
 */
export function getValidOrigin(origin: string): string {
  const _type = typeof origin;
  if (_type !== "string") {
    throw Error(`Invalid origin type. Expected "string" but got "${_type}".`);
  }
  const result = origin.match(originRegex);
  if (result === null) {
    if (origin[0] === "/") {
      return window.location.origin;
    }
    throw Error(`Origin not found in string: "${origin}".`);
  }
  return result[0];
}
