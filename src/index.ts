import {
  instantiateMteWasm as initMteWasm,
  createMteEncoder,
  createMteDecoder,
  mteEncode,
  mteDecode,
} from "mte-helpers";
import {
  MTE_ID_HEADER,
  MTE_ENCODED_CONTENT_TYPE_HEADER_NAME,
  MTE_CLIENT_ID_HEADER,
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
import { MteRelayError } from "./utils/mte-relay-error";
import { getValidOrigin } from "./utils/get-valid-origin";

export { MteRelayError } from "./utils/mte-relay-error";

const MTE_CLIENT_ID = generateRandomId();

// export init function
export async function instantiateMteWasm(options: {
  licenseKey: string;
  licenseCompany: string;
}) {
  await initMteWasm({
    licenseKey: options.licenseKey,
    licenseCompany: options.licenseCompany,
    sequenceWindow: -63,
    decoderType: "MKE",
    encoderType: "MKE",
    keepAlive: Infinity,
  });
}

// export network request function
export async function mteFetch(url: string, options: RequestInit) {
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
    const originMteId = await requestServerTranslatorId(urlOrigin);
    mteRelayOrigin = registerOrigin({
      origin: urlOrigin,
      mteId: originMteId,
    });
    await pairWithOrigin(urlOrigin, originMteId);
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
  const encodedOptions = await encodeRequest(_options, mteRelayOrigin);

  /**
   * Send the request
   */
  let response = await fetch(url, encodedOptions);

  // handle a bad response
  if (!response.ok) {
    if (response.status !== 559) {
      return response;
    }

    /**
     * Watch for special status code that triggers a re-pairing event.
     * If we see status code 559
     * - re-pair with MTE Server Relay
     * - re-encode original request data
     * - re-send request with newly encoded data
     */
    if (response.status === 559) {
      let maxAttempts = 2;
      let i = 0;
      for (; i < maxAttempts; ++i) {
        try {
          unregisterOrigin(urlOrigin);
          const originMteId = await requestServerTranslatorId(urlOrigin);
          mteRelayOrigin = registerOrigin({
            origin: urlOrigin,
            mteId: originMteId,
          });
          await pairWithOrigin(mteRelayOrigin.origin, mteRelayOrigin.mteId);
          const encodedOptions = await encodeRequest(_options, mteRelayOrigin);
          response = await fetch(url, encodedOptions);

          // if the response is now successful, end loop
          if (response.ok) {
            break;
          }
        } catch (err) {
          console.log(err);
        }
      }
    }
  }

  // decode header content-type
  const encodedContentTypeHeader = response.headers.get(
    MTE_ENCODED_CONTENT_TYPE_HEADER_NAME
  );

  let decodedContentTypeHeader = "application/json";
  if (encodedContentTypeHeader) {
    // @ts-ignore
    const _ContentTypeHeader = await mteDecode(encodedContentTypeHeader, {
      id: `decoder_${mteRelayOrigin.mteId}`,
      output: "str",
    });
    if (_ContentTypeHeader) {
      decodedContentTypeHeader = _ContentTypeHeader;
    }
  }

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

  const _output = contentTypeIsText(decodedContentTypeHeader)
    ? "str"
    : "Uint8Array";

  const decodedBody = await mteDecode(u8, {
    id: `decoder_${mteRelayOrigin.mteId}`,
    // @ts-ignore
    output: _output,
  });

  /**
   * Define response object methods to match normal response object methods
   */
  response.json = async function () {
    return JSON.parse(decodedBody);
  };
  response.text = async function () {
    return decodedBody;
  };
  response.blob = async function () {
    const result = new Blob([decodedBody]);
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
  const response = await fetch(origin + "/api/mte-relay", {
    method: "HEAD",
    credentials: "include",
    headers: {
      [MTE_CLIENT_ID_HEADER]: MTE_CLIENT_ID,
    },
  });
  if (!response.ok) {
    throw new MteRelayError("Origin is not an MTE Relay origin.");
  }
  const originMteId = response.headers.get(MTE_ID_HEADER);
  if (!originMteId) {
    throw new MteRelayError("Origin is not an MTE Relay origin.");
  }
  return originMteId;
}

/**
 * Pair with Server MTE Translator
 */
async function pairWithOrigin(origin: string, originMteId: string) {
  const encoderPersonalizationStr = generateRandomId();
  const encoderEcdh = await getEcdh();
  const decoderPersonalizationStr = generateRandomId();
  const decoderEcdh = await getEcdh();

  const response = await fetch(`${origin}/api/mte-pair`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [MTE_CLIENT_ID_HEADER]: MTE_CLIENT_ID,
    },
    credentials: "include",
    body: JSON.stringify({
      encoderPersonalizationStr,
      encoderPublicKey: encoderEcdh.publicKey,
      decoderPersonalizationStr,
      decoderPublicKey: decoderEcdh.publicKey,
    }),
  });
  if (!response.ok) {
    throw new MteRelayError("Failed to pair with server MTE Translator.");
  }

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
  await createMteEncoder({
    entropy: encoderEntropy,
    nonce: pairResponseData.decoderNonce,
    personalization: encoderPersonalizationStr,
    id: `encoder_${originMteId}`,
  });

  await createMteDecoder({
    entropy: decoderEntropy,
    nonce: pairResponseData.encoderNonce,
    personalization: decoderPersonalizationStr,
    id: `decoder_${originMteId}`,
  });
}

/**
 * encode headers and body of request
 */
async function encodeRequest(
  options: RequestInit,
  originRecord: MteRelayRecord
) {
  // clone original into new copy and modify copy
  const _options = cloneDeep(options);

  // create the encoder id once, use it where needed
  const encoderId = `encoder_${originRecord.mteId}`;

  // encode the content-type header (if it exists)
  const headers = new Headers(_options.headers);
  headers.append(MTE_CLIENT_ID_HEADER, MTE_CLIENT_ID);
  const originalContentTypeHeader = headers.get("content-type");
  if (originalContentTypeHeader) {
    const encodedHeader = await mteEncode(originalContentTypeHeader, {
      id: encoderId,
      output: "B64",
    });
    headers.set(MTE_ENCODED_CONTENT_TYPE_HEADER_NAME, encodedHeader);
    headers.delete("content-type");
  }
  _options.headers = headers;

  // Determine how to encode the body (if it exists)
  if (_options.body) {
    await (async () => {
      // handle strings
      if (typeof _options.body === "string") {
        _options.body = await mteEncode(_options.body as any, {
          id: encoderId,
          output: "Uint8Array",
        });
        headers.set("content-type", "application/octet-stream");
        return;
      }

      // handle Uint8Arrays
      if (_options.body instanceof Uint8Array) {
        _options.body = await mteEncode(_options.body as any, {
          id: encoderId,
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
          const encodedKey = await mteEncode(key, {
            id: encoderId,
            output: "B64",
          });

          // handle value as a string
          if (typeof value === "string") {
            const encodedValue = await mteEncode(value, {
              id: encoderId,
              output: "B64",
            });
            _encodedFormData.set(encodedKey, encodedValue);
            continue;
          }

          // handle value as a File object
          if (value instanceof File) {
            let fileName = value.name;
            if (fileName) {
              fileName = await mteEncode(fileName, {
                id: encoderId,
                output: "B64",
              });
              // URI encode the filename
              fileName = encodeURIComponent(fileName);
            }
            const buffer = await value.arrayBuffer();
            const u8 = new Uint8Array(buffer);
            const encodedValue = await mteEncode(u8, {
              id: encoderId,
              output: "Uint8Array",
            });
            _encodedFormData.set(
              encodedKey,
              new File([encodedValue], fileName)
            );
            continue;
          }

          // throw error if we don't know what the value type is
          console.log(typeof value, value);
          throw new MteRelayError("Unknown value to encode.");
        }

        // set the value of the body to our newly encoded formData
        _options.body = _encodedFormData;
        return;
      }

      // handle arraybuffers
      if (_options.body instanceof ArrayBuffer) {
        _options.body = await mteEncode(new Uint8Array(_options.body), {
          id: encoderId,
          output: "Uint8Array",
        });
        return;
      }

      // handle URLSearchParams
      if (_options.body instanceof URLSearchParams) {
        _options.body = await mteEncode(_options.body.toString(), {
          id: encoderId,
          output: "Uint8Array",
        });
        headers.set("content-type", "application/octet-stream");
        return;
      }

      // handle DataView
      if ((_options.body as DataView).buffer instanceof ArrayBuffer) {
        const u8 = new Uint8Array((_options.body as DataView).buffer);
        _options.body = await mteEncode(u8, {
          id: encoderId,
          output: "Uint8Array",
        });
        return;
      }

      // handle Blob, File, etc...
      if (typeof (_options.body as Blob).arrayBuffer === "function") {
        const buffer = await (_options.body as Blob).arrayBuffer();
        const u8 = new Uint8Array(buffer);
        _options.body = await mteEncode(u8, {
          id: encoderId,
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
