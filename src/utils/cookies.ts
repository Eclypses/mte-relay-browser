/**
 * Sets a cookie with the specified name and value.
 * @param {string} name - The name of the cookie.
 * @param {string} value - The value to be stored in the cookie.
 * @param {number} [days] - The number of days until the cookie expires. If not provided, defaults to 30 days.
 */

const isBrowser = typeof window !== "undefined";

export function setCookie(name: string, value: string, days?: number) {
  if (!isBrowser) {
    return undefined;
  }
  let _days = 30;
  if (days) {
    _days = days;
  }
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + _days);

  const domain = getCurrentDomain();
  if (!domain) {
    return undefined;
  }

  let cookieValue = `${encodeURIComponent(
    value
  )}; expires=${expirationDate.toUTCString()}; path=/;`;
  if (!domain.includes("localhost")) {
    cookieValue += ` domain=${domain};`;
  }
  document.cookie = `${name}=${cookieValue}`;
  console.log("cookie set", `${name}=${cookieValue}`);
  return undefined;
}

/**
 * Retrieves the current domain of the website.
 * @returns {string} - The current domain of the website.
 */
function getCurrentDomain() {
  if (!isBrowser) {
    return undefined;
  }
  var parser = document.createElement("a");
  parser.href = window.location.href;
  var domain = parser.hostname;

  // Remove any subdomains and 'www.' prefix
  domain = domain.replace(/^(www\.)?([^.]+\.)/, "");

  // Extract the top-level domain
  var topLevelDomain = domain.split(".").slice(-2).join(".");

  // Return the formatted domain
  return "." + topLevelDomain;
}

/**
 * Searches for a cookie with the specified name and returns its value.
 * @param {string} name - The name of the cookie to search for.
 * @returns {string | null} - The value of the cookie if found, or null if not found.
 */
export function getCookieValue(name: string): string | null {
  if (!isBrowser) {
    return null;
  }

  const cookieArray = document.cookie.split(";");

  for (const cookie of cookieArray) {
    const [cookieName, cookieValue] = cookie.trim().split("=");

    if (cookieName === name) {
      return decodeURIComponent(cookieValue);
    }
  }

  return null; // Cookie not found
}
