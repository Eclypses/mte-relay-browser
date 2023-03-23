// regex to identify origin scheme:hostname[:port]
const originRegex = /^[\w-]+:\/*\[?[\p{L}\d\\.:_-]+\]?(?::\d*)?/u;

/**
 * Takes in a string and returns the origin, or throws an error if no origin is found.
 * @param url A string that include an origin or type: scheme:host[:port]
 * @returns A string of the origin.
 *
 * ```js
 * getValidOrigin("https://eclypses.com/mte-technology/website-security/");
 * // returns "https://eclypses.com"
 * ```
 */
export function getValidOrigin(url: RequestInfo | URL): string {
  let _url = "";

  // runtime type check;
  (() => {
    if (url instanceof URL) {
      return (_url = url.toString());
    }
    if (url instanceof Request) {
      return (_url = url.url);
    }
    const _type = typeof url;
    if (_type === "string") {
      return (_url = url);
    }
    throw new Error(
      `Invalid url type. Expected URL|Request|String but got "${_type}".`
    );
  })();

  // use regex to find origin
  const result = _url.match(originRegex);
  if (result?.[0]) {
    return result[0];
  }

  // if no origin is found, check if url is relative
  if (_url[0] === "/") {
    return window.location.origin;
  }

  throw new Error(`Origin not found in string: ${_url}`);
}
