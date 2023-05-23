import {
  instantiateDecoder,
  instantiateEncoder,
  instantiateMteWasm as initWasm,
  mkeDecode,
  mkeEncode,
} from "./mte";
import {
  SERVER_ID_HEADER,
  CLIENT_ID_HEADER,
  MTE_ENCODED_HEADERS_HEADER,
  SESSION_ID_HEADER,
} from "./constants";
import {
  getRegisteredOrigin,
  MteRelayRecord,
  registerOrigin,
  unregisterOrigin,
} from "./origin-cache";
import { generateRandomId } from "./utils/generate-id";
import { getEcdh } from "./utils/ecdh";
import cloneDeep from "lodash.clonedeep";
import { MteRelayError } from "./mte/errors";
import { getValidOrigin } from "./utils/get-valid-origin";
import { setCookie, getCookieValue } from "./utils/cookies";

let SESSION_ID: string = "";
let CLIENT_ID: string | null;

// export init function
export async function instantiateMteWasm(options: {
  licenseKey: string;
  licenseCompany: string;
}) {
  await initWasm({
    licenseKey: options.licenseKey,
    companyName: options.licenseCompany,
  });
  const clientId = getCookieValue(CLIENT_ID_HEADER);
  if (clientId) {
    CLIENT_ID = clientId;
  }
  SESSION_ID = generateRandomId();
}

type MteRequestOptions = {
  encodeHeaders: boolean | string[];
};

const defaultMteRequestOptions: MteRequestOptions = {
  encodeHeaders: true,
};

// export network request function
export async function mteFetch(
  url: RequestInfo,
  options?: RequestInit,
  mteOptions?: MteRequestOptions
) {
  if (url instanceof Request && typeof url !== "string") {
    throw new Error("Request not support yet. Use string url for now.");
  }

  // merge defaults with user provide options
  const _mteOptions = Object.assign(defaultMteRequestOptions, mteOptions);

  let _options = options || {};
  let mteRelayOrigin = getRegisteredOrigin(url);

  /**
   * If origin is not yet registered,
   * - check if origin is an MTE Relay server
   * - register origin
   * - pair with origin
   */
  const urlOrigin = getValidOrigin(url);
  if (!mteRelayOrigin) {
    const mteRelayServerId = await requestServerTranslatorId(urlOrigin);
    mteRelayOrigin = registerOrigin({
      origin: urlOrigin,
      mteId: mteRelayServerId,
    });
    await pairWithOrigin(urlOrigin);
  }

  // include cookies with every request, they are tracked by the server relay
  _options.credentials = "include";

  // no-store response
  _options.cache = "no-store";

  // add headers if they do not exist
  const _headers = new Headers(_options.headers || {});

  // set headers
  _options.headers = _headers;

  /**
   * MTE Encode Headers and Body (if they exist)
   */
  const encodedOptions = await encodeRequest(
    _options,
    mteRelayOrigin,
    _mteOptions
  );

  /**
   * Send the request
   */
  let response = await fetch(url, encodedOptions);

  // handle a bad response
  if (!response.ok) {
    if (!MteRelayError.isMteErrorStatus(response.status)) {
      return response;
    }
    const message = MteRelayError.getStatusErrorMessages(response.status);
    console.error(message);
    SESSION_ID = generateRandomId();

    /**
     * - re-pair with MTE Server Relay
     * - re-encode original request data
     * - re-send request with newly encoded data
     */
    try {
      unregisterOrigin(urlOrigin);
      const mteRelayServerId = await requestServerTranslatorId(urlOrigin);
      mteRelayOrigin = registerOrigin({
        origin: urlOrigin,
        mteId: mteRelayServerId,
      });
      await pairWithOrigin(mteRelayOrigin.origin);
      const encodedOptions = await encodeRequest(
        _options,
        mteRelayOrigin,
        _mteOptions
      );
      response = await fetch(url, encodedOptions);
    } catch (err) {
      let message = `MTE Fetch failed`;
      if (err instanceof Error) {
        message += `: ${err.message}`;
      }
      throw Error(message);
    }
  }
  // get server ID
  const serverId = response.headers.get(SERVER_ID_HEADER);
  if (!serverId) {
    throw new Error(`Response is missing header: ${SERVER_ID_HEADER}`);
  }
  // save client ID
  CLIENT_ID = response.headers.get(CLIENT_ID_HEADER);
  if (!CLIENT_ID) {
    throw new Error(`Response is missing header: ${CLIENT_ID_HEADER}`);
  }
  setCookie(CLIENT_ID_HEADER, CLIENT_ID);

  // get response as blob
  const blob = await response.blob();

  // if blob is empty, return early
  if (blob.size < 1) {
    response.json = async function () {
      return null;
    };
    response.text = async function () {
      return "";
    };
    response.blob = async function () {
      return blob;
    };
    return response;
  }

  const buffer = await blob.arrayBuffer();
  const u8 = new Uint8Array(buffer);

  let contentType = "application/json";
  const _contentType = response.headers.get("content-type");
  if (_contentType) {
    contentType = _contentType;
  }
  const _output = contentTypeIsText(contentType) ? "str" : "Uint8Array";

  const decodedBody = await mkeDecode(u8, {
    stateId: `decoder.${serverId}.${SESSION_ID}`,
    // @ts-ignore
    output: _output,
  });

  /**
   * Define response object methods to match normal response object methods
   */
  response.json = async function () {
    return JSON.parse(decodedBody as string);
  };
  response.text = async function () {
    return decodedBody as string;
  };
  response.blob = async function () {
    const result = new Blob([decodedBody as Uint8Array]);
    return result;
  };
  return response;
}

// determine if encoded content should be decoded to text or to UInt8Array
function contentTypeIsText(contentType: string) {
  const textsTypes = ["text", "json", "xml", "javascript"];
  return textsTypes.some((i) => contentType.toLowerCase().includes(i));
}

/**
 * Make a HEAD request to check for x-mte-id response header,
 * If it exists, we assume the origin is an mte translator.
 */
async function requestServerTranslatorId(origin: string) {
  const _headers: Record<string, string> = {
    [SESSION_ID_HEADER]: SESSION_ID,
  };
  if (CLIENT_ID) {
    _headers[CLIENT_ID_HEADER] = CLIENT_ID;
  }
  const response = await fetch(origin + "/api/mte-relay", {
    method: "HEAD",
    credentials: "include",
    headers: _headers,
  });
  if (!response.ok) {
    throw new Error("Origin is not an MTE Relay origin.");
  }
  const serverId = response.headers.get(SERVER_ID_HEADER);
  if (!serverId) {
    throw new Error(`Response is missing header: ${SERVER_ID_HEADER}`);
  }
  CLIENT_ID = response.headers.get(CLIENT_ID_HEADER);
  if (!CLIENT_ID) {
    throw new Error(`Response is missing header: ${CLIENT_ID_HEADER}`);
  }
  setCookie(CLIENT_ID_HEADER, CLIENT_ID);
  return serverId;
}

/**
 * Pair with Server MTE Translator
 */
async function pairWithOrigin(origin: string) {
  const encoderPersonalizationStr = generateRandomId();
  const encoderEcdh = await getEcdh();
  const decoderPersonalizationStr = generateRandomId();
  const decoderEcdh = await getEcdh();

  const _headers: Record<string, string> = {
    "Content-Type": "application/json",
    [SESSION_ID_HEADER]: SESSION_ID,
  };
  if (CLIENT_ID) {
    _headers[CLIENT_ID_HEADER] = CLIENT_ID;
  }

  const response = await fetch(`${origin}/api/mte-pair`, {
    method: "POST",
    headers: _headers,
    credentials: "include",
    body: JSON.stringify({
      encoderPersonalizationStr,
      encoderPublicKey: encoderEcdh.publicKey,
      decoderPersonalizationStr,
      decoderPublicKey: decoderEcdh.publicKey,
    }),
  });
  if (!response.ok) {
    throw new Error("Failed to pair with server MTE Translator.");
  }
  const serverId = response.headers.get(SERVER_ID_HEADER);
  if (!serverId) {
    throw new Error(`Response is missing header: ${SERVER_ID_HEADER}`);
  }
  CLIENT_ID = response.headers.get(CLIENT_ID_HEADER);
  if (!CLIENT_ID) {
    throw new Error(`Response is missing header: ${CLIENT_ID_HEADER}`);
  }
  setCookie(CLIENT_ID_HEADER, CLIENT_ID);

  // convert response to json
  const pairResponseData = await response.json();

  // create entropy
  const encoderEntropy = await encoderEcdh.computeSharedSecret(
    pairResponseData.decoderPublicKey
  );
  const decoderEntropy = await decoderEcdh.computeSharedSecret(
    pairResponseData.encoderPublicKey
  );

  // create encoder/decoder
  await instantiateEncoder({
    entropy: encoderEntropy,
    nonce: pairResponseData.decoderNonce,
    personalization: encoderPersonalizationStr,
    id: `encoder.${serverId}.${SESSION_ID}`,
  });

  await instantiateDecoder({
    entropy: decoderEntropy,
    nonce: pairResponseData.encoderNonce,
    personalization: decoderPersonalizationStr,
    id: `decoder.${serverId}.${SESSION_ID}`,
  });
}

/**
 * encode headers and body of request
 */
async function encodeRequest(
  options: RequestInit,
  originRecord: MteRelayRecord,
  mteOptions: MteRequestOptions
) {
  // clone original into new copy and modify copy
  const _options = cloneDeep(options);

  // create the encoder id once, use it where needed
  const encoderId = `encoder.${originRecord.mteId}.${SESSION_ID}`;

  // encode the content-type header (if it exists)
  const headers = new Headers(_options.headers);

  // encode headers
  const _headers: Headers = await (async () => {
    const headersToEncode: Record<string, string> = {};

    // original content-type ALWAYS must be encoded and preserved (because we have to change content-type to application/octet-stream)
    const contentType = headers.get("content-type");
    if (contentType) {
      headersToEncode["content-type"] = contentType;
    }

    // if boolean, encode all or nothing
    if (typeof mteOptions.encodeHeaders === "boolean") {
      if (mteOptions.encodeHeaders === true) {
        for (const [name, value] of headers.entries()) {
          headersToEncode[name] = value;
          headers.delete(name);
        }
      }
      const headersJSON = JSON.stringify(headersToEncode);
      console.log("headersJSON", headersJSON);
      const encodedHeader = await mkeEncode(headersJSON, {
        stateId: encoderId,
        output: "B64",
      });
      headers.set(MTE_ENCODED_HEADERS_HEADER, encodedHeader as string);
      return headers;
    }

    // if array, encode just those headers
    if (Array.isArray(mteOptions.encodeHeaders)) {
      const allStrings = mteOptions.encodeHeaders.every(
        (i) => typeof i === "string"
      );
      if (!allStrings) {
        throw Error(
          `Expected an array of strings for mteOptions.encodeHeaders, but received ${mteOptions.encodeHeaders}.`
        );
      }
      // encode each header (except content-type header, which is ALWAYS encoded)
      const sansContentType = mteOptions.encodeHeaders.filter(
        (i) => i !== "content-type"
      );
      for (const headerName of sansContentType) {
        const headerValue = headers.get(headerName);
        if (headerValue) {
          headersToEncode[headerName] = headerValue;
          headers.delete(headerName);
        }
      }
      const headersJSON = JSON.stringify(headersToEncode);
      const encodedHeaders = await mkeEncode(headersJSON, {
        stateId: encoderId,
        output: "B64",
      });
      headers.set(MTE_ENCODED_HEADERS_HEADER, encodedHeaders as string);
      return headers;
    }
    throw Error(
      `Unexpected type for mteOptions.encodeHeaders. Expected boolean or string array, but received ${typeof mteOptions.encodeHeaders}.`
    );
  })();

  // append mte relay client and session IDs
  _headers.append(CLIENT_ID_HEADER, CLIENT_ID!);
  _headers.append(SESSION_ID_HEADER, SESSION_ID);
  _headers.set("content-type", "application/octet-stream");

  _options.headers = _headers;

  // Determine how to encode the body (if it exists)
  if (_options.body) {
    await (async () => {
      // handle strings
      if (typeof _options.body === "string") {
        _options.body = await mkeEncode(_options.body as any, {
          stateId: encoderId,
          output: "Uint8Array",
        });
        return;
      }

      // handle Uint8Arrays
      if (_options.body instanceof Uint8Array) {
        _options.body = await mkeEncode(_options.body as any, {
          stateId: encoderId,
          output: "Uint8Array",
        });
        return;
      }

      // handle FormData
      if (_options.body instanceof FormData) {
        // create new formData object
        const _encodedFormData = new FormData();

        // loop over all entries of the original formData
        const entries = _options.body.entries();
        for await (const [key, value] of entries) {
          // encode the key
          const encodedKey = await mkeEncode(key, {
            stateId: encoderId,
            output: "B64",
          });

          // handle value as a string
          if (typeof value === "string") {
            const encodedValue = await mkeEncode(value, {
              stateId: encoderId,
              output: "B64",
            });
            _encodedFormData.set(encodedKey as string, encodedValue as string);
            continue;
          }

          // handle value as a File object
          if (value instanceof File) {
            let fileName = value.name;
            if (fileName) {
              fileName = (await mkeEncode(fileName, {
                stateId: encoderId,
                output: "B64",
              })) as string;
              // URI encode the filename
              fileName = encodeURIComponent(fileName);
            }
            const buffer = await value.arrayBuffer();
            const u8 = new Uint8Array(buffer);
            const encodedValue = await mkeEncode(u8, {
              stateId: encoderId,
              output: "Uint8Array",
            });
            _encodedFormData.set(
              encodedKey as string,
              new File([encodedValue as string], fileName)
            );
            continue;
          }

          // throw error if we don't know what the value type is
          console.log(typeof value, value);
          throw new Error("Unknown value to encode.");
        }

        // set the value of the body to our newly encoded formData
        _options.body = _encodedFormData;
        return;
      }

      // handle arraybuffers
      if (_options.body instanceof ArrayBuffer) {
        _options.body = await mkeEncode(new Uint8Array(_options.body), {
          stateId: encoderId,
          output: "Uint8Array",
        });
        return;
      }

      // handle URLSearchParams
      if (_options.body instanceof URLSearchParams) {
        _options.body = await mkeEncode(_options.body.toString(), {
          stateId: encoderId,
          output: "Uint8Array",
        });
        return;
      }

      // handle DataView
      if ((_options.body as DataView).buffer instanceof ArrayBuffer) {
        const u8 = new Uint8Array((_options.body as DataView).buffer);
        _options.body = await mkeEncode(u8, {
          stateId: encoderId,
          output: "Uint8Array",
        });
        return;
      }

      // handle Blob, File, etc...
      if (typeof (_options.body as Blob).arrayBuffer === "function") {
        const buffer = await (_options.body as Blob).arrayBuffer();
        const u8 = new Uint8Array(buffer);
        _options.body = await mkeEncode(u8, {
          stateId: encoderId,
          output: "Uint8Array",
        });
        return;
      }

      // handle readable stream
      if (_options.body instanceof ReadableStream) {
        throw new Error("Readable streams are not supported, yet.");
      }
    })();
  }

  return _options;
}
