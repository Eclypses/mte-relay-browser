import {
  instantiateDecoder,
  instantiateEncoder,
  instantiateMteWasm as initWasm,
  mkeDecode,
  mkeEncode,
  getNextPairIdFromQueue,
  setEncoderDecoderPoolSize,
  deleteIdFromQueue,
} from "./mte";
import {
  SERVER_ID_HEADER,
  CLIENT_ID_HEADER,
  MTE_ENCODED_HEADERS_HEADER,
  PAIR_ID_HEADER,
  ENCODER_TYPE_HEADER,
} from "./constants";
import { setServerStatus, validateServer } from "./origin-cache";
import { generateRandomId } from "./utils/generate-id";
import { getEcdh } from "./utils/ecdh";
import { MteRelayError } from "./mte/errors";
import { setCookie, getCookieValue, expireCookie } from "./utils/cookies";

let CLIENT_ID: string | null;
let NUMBER_OF_PAIRS = 5;
let DEFAULT_ENCRYPTION_TYPE: "MTE" | "MKE" = "MKE";

/**
 * Instantiates the MTE WebAssembly module with the given options.
 *
 * @param {string} options.licenseKey - The license key for the MTE module.
 * @param {string} options.licenseCompany - The name of the licensing company.
 * @param {number} [options.numberEncoderDecoderPairs] - Indicates how many encoder/decoder pairs to create with MTE Relay Servers. Defaults to 5.
 * @param {number} [options.encoderDecoderPoolSize] - Indicates how many encoder/decoder objects to hold in memory at a time. Defaults to 5.
 * @returns {Promise<void>} A promise that resolves after the MTE module is initialized.
 */
export async function instantiateMteWasm(options: {
  licenseKey: string;
  licenseCompany: string;
  numberEncoderDecoderPairs?: number;
  encoderDecoderPoolSize?: number;
  defaultEncodeType?: "MTE" | "MKE";
}) {
  if (options.numberEncoderDecoderPairs) {
    NUMBER_OF_PAIRS = options.numberEncoderDecoderPairs;
  }
  if (options.encoderDecoderPoolSize) {
    setEncoderDecoderPoolSize(options.encoderDecoderPoolSize);
  }
  if (options.defaultEncodeType) {
    DEFAULT_ENCRYPTION_TYPE = options.defaultEncodeType;
  }
  await initWasm({
    licenseKey: options.licenseKey,
    companyName: options.licenseCompany,
  });
  const clientId = getCookieValue(CLIENT_ID_HEADER);
  if (clientId) {
    CLIENT_ID = clientId;
  }
}

type MteRequestOptions = {
  encodeHeaders: boolean | string[];
  encodeType: "MTE" | "MKE";
};

// send encoded request
// if it throws an MTE error, try again 1 time
export async function mteFetch(
  url: RequestInfo,
  options?: RequestInit,
  mteOptions?: MteRequestOptions
) {
  return await sendMteRequest(url, options, mteOptions);
}

// export network request function
async function sendMteRequest(
  url: RequestInfo,
  options?: RequestInit,
  mteOptions?: MteRequestOptions,
  requestOptions?: {
    isLastAttempt?: boolean;
    revalidateServer?: boolean;
  }
): Promise<Response> {
  let pairId = "";
  let originId = "";
  let serverOrigin = "";

  try {
    // use or create Request object
    let _request: Request;
    if (url instanceof Request) {
      _request = url;
    } else {
      _request = new Request(url, options);
    }
    const _url = new URL(_request.url);

    // preserve server origin, incase request fails and we need to resend
    serverOrigin = _url.origin;

    // validate server is MTE Relay server
    let serverRecord = validateServer(serverOrigin);

    // default values, if they're not provided
    const defaultMteRequestOptions: MteRequestOptions = {
      encodeHeaders: true,
      encodeType: DEFAULT_ENCRYPTION_TYPE,
    };

    // init options objects
    const _mteOptions = Object.assign(defaultMteRequestOptions, mteOptions);

    // validate server is MTE Relay Server, pair with it
    if (
      serverRecord.status === "validate" ||
      requestOptions?.revalidateServer
    ) {
      let mteRelayServerId;
      try {
        mteRelayServerId = await requestServerId(serverRecord.origin);
      } catch (error: any) {
        if (MteRelayError.isMteErrorStatus(error.status)) {
          throw new MteRelayError(
            MteRelayError.getStatusErrorMessages(error.status)!
          );
        } else {
          setServerStatus(serverRecord.origin, "invalid");
          throw new Error("Origin is not an MTE Relay server.");
        }
      }
      await pairWithOrigin(serverRecord.origin).catch(() => {
        setServerStatus(serverRecord.origin, "invalid");
        throw new Error("Origin is not an MTE Relay server.");
      });
      serverRecord = setServerStatus(
        serverRecord.origin,
        "paired",
        mteRelayServerId
      );
    }

    // if it's pending, recheck every (100 * i)ms
    if (serverRecord.status === "pending") {
      for (let i = 0; i < 20; ++i) {
        await sleep((1 + i) * 100);
        serverRecord = validateServer(serverOrigin);
        if (serverRecord.status === "paired") {
          break;
        }
        if (serverRecord.status === "invalid") {
          throw new Error("Origin is not an MTE Relay server.");
        }
      }
      if (serverRecord.status !== "paired") {
        throw new Error("Origin is not an MTE Relay server.");
      }
    }
    if (serverRecord.status === "invalid") {
      throw new Error("Origin is not an MTE Relay server.");
    }
    if (!serverRecord.serverId) {
      throw new Error("Origin is not an MTE Relay server.");
    }

    pairId = getNextPairIdFromQueue(serverRecord.serverId);
    originId = serverRecord.serverId;

    /**
     * MTE Encode Headers and Body (if they exist)
     */
    const encodedRequest = await encodeRequest(
      _request,
      _mteOptions,
      originId,
      pairId
    );

    /**
     * Send the request
     */
    let response = await fetch(encodedRequest);

    // handle a bad response
    if (!response.ok) {
      if (MteRelayError.isMteErrorStatus(response.status)) {
        const msg = MteRelayError.getStatusErrorMessages(response.status);
        if (msg) {
          throw new MteRelayError(msg);
        }
      }
      return response;
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

    // get session ID from this request/response
    const responsePairId = response.headers.get(PAIR_ID_HEADER);
    if (!responsePairId) {
      throw new Error(`Response is missing header: ${PAIR_ID_HEADER}`);
    }

    // decode encoded headers
    const responseHeaders = new Headers(response.headers);
    const responseEncodedHeaders = responseHeaders.get(
      MTE_ENCODED_HEADERS_HEADER
    );
    if (responseEncodedHeaders) {
      const responseDecodedHeadersJson = await mkeDecode(
        responseEncodedHeaders,
        {
          id: `decoder.${serverId}.${responsePairId}`,
          output: "str",
          type: _mteOptions.encodeType,
        }
      );
      const responseDecodedHeaders = JSON.parse(
        responseDecodedHeadersJson as string
      );
      for (const headerName in responseDecodedHeaders) {
        responseHeaders.set(headerName, responseDecodedHeaders[headerName]);
      }
    }
    responseHeaders.delete(MTE_ENCODED_HEADERS_HEADER);
    responseHeaders.delete(CLIENT_ID_HEADER);
    responseHeaders.delete(PAIR_ID_HEADER);
    responseHeaders.delete(ENCODER_TYPE_HEADER);

    // decode response body, if present
    let decryptedBody: Uint8Array | null = null;
    if (response.body) {
      const buffer = await response.arrayBuffer();
      const u8 = new Uint8Array(buffer);
      decryptedBody = (await mkeDecode(u8, {
        id: `decoder.${serverId}.${responsePairId}`,
        // @ts-ignore
        output: "Uint8Array",
        type: _mteOptions.encodeType,
      })) as Uint8Array;
    }

    // return decoded response
    return new Response(decryptedBody, {
      headers: responseHeaders,
      status: response.status,
      statusText: response.statusText,
    });
  } catch (error) {
    if (error instanceof MteRelayError) {
      deleteIdFromQueue({ serverId: originId, pairId });
      if (error.status === 566) {
        setServerStatus(serverOrigin, "pending");
        CLIENT_ID = null;
        expireCookie(CLIENT_ID_HEADER);
        if (requestOptions?.isLastAttempt) {
          throw new Error("Origin is not an MTE Relay server.");
        }
        return await sendMteRequest(url, options, mteOptions, {
          revalidateServer: true,
          isLastAttempt: true,
        });
      }
      pairWithOrigin(serverOrigin, 1);
      if (!requestOptions?.isLastAttempt) {
        return await sendMteRequest(url, options, mteOptions, {
          isLastAttempt: true,
        });
      }
    }
    let message = "An unknown error occurred.";
    if (error instanceof Error) {
      message = error.message;
    }
    throw Error(message);
  }
}

/**
 * Make a HEAD request to check for x-mte-id response header,
 * If it exists, we assume the origin is an mte translator.
 */
async function requestServerId(origin: string) {
  const _headers: Record<string, string> = {};
  if (CLIENT_ID) {
    _headers[CLIENT_ID_HEADER] = CLIENT_ID;
  }
  const response = await fetch(origin + "/api/mte-relay", {
    method: "HEAD",
    credentials: "include",
    headers: _headers,
  });

  if (MteRelayError.isMteErrorStatus(response.status)) {
    throw new MteRelayError(
      MteRelayError.getStatusErrorMessages(response.status)!
    );
  }

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
async function pairWithOrigin(origin: string, numberOfPairs?: number) {
  if (!CLIENT_ID) {
    throw new Error("Client ID is not set.");
  }

  const initValues = [];
  const ecdh = [];

  let i = 0;
  const iMax = numberOfPairs || NUMBER_OF_PAIRS;
  for (; i < iMax; ++i) {
    const pairId = generateRandomId();
    const encoderPersonalizationStr = generateRandomId();
    const encoderEcdh = await getEcdh("raw");
    const decoderPersonalizationStr = generateRandomId();
    const decoderEcdh = await getEcdh("raw");

    initValues.push({
      pairId,
      encoderPersonalizationStr,
      encoderPublicKey: encoderEcdh.publicKey,
      decoderPersonalizationStr,
      decoderPublicKey: decoderEcdh.publicKey,
    });

    ecdh.push({ encoderEcdh, decoderEcdh });
  }

  const _headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  _headers[CLIENT_ID_HEADER] = CLIENT_ID;

  const response = await fetch(`${origin}/api/mte-pair`, {
    method: "POST",
    headers: _headers,
    credentials: "include",
    body: JSON.stringify(initValues),
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
  const pairResponseData: {
    pairId: string;
    encoderPublicKey: string;
    encoderNonce: string;
    decoderPublicKey: string;
    decoderNonce: string;
  }[] = await response.json();

  let j = 0;
  for (; j < pairResponseData.length; ++j) {
    const pairInit = initValues[j];
    const pairResponse = pairResponseData[j];
    const _ecdh = ecdh[j];

    // create entropy
    const encoderEntropy = await _ecdh.encoderEcdh.computeSharedSecret(
      pairResponse.decoderPublicKey
    );
    const decoderEntropy = await _ecdh.decoderEcdh.computeSharedSecret(
      pairResponse.encoderPublicKey
    );

    // create encoder/decoder
    await instantiateEncoder({
      entropy: encoderEntropy,
      nonce: pairResponse.decoderNonce,
      personalization: pairInit.encoderPersonalizationStr,
      serverId: serverId,
      pairId: pairResponse.pairId,
    });

    await instantiateDecoder({
      entropy: decoderEntropy,
      nonce: pairResponse.encoderNonce,
      personalization: pairInit.decoderPersonalizationStr,
      serverId: serverId,
      pairId: pairResponse.pairId,
    });
  }
}

/**
 * encode headers and body of request
 */
async function encodeRequest(
  request: Request,
  mteOptions: MteRequestOptions,
  serverId: string,
  pairId: string
) {
  // encrypt the route: /path/to/thing?query=string&query2=string2
  const requestUrl = new URL(request.url);
  const route = requestUrl.pathname.slice(1) + requestUrl.search;
  const encryptedRoute = (await mkeEncode(route, {
    id: `encoder.${serverId}.${pairId}`,
    output: "B64",
    type: mteOptions.encodeType,
  })) as string;
  const uriEncoded = encodeURIComponent(encryptedRoute);
  const encryptedUrl = requestUrl.origin + "/" + uriEncoded;
  // if longer than 2048 throw error - should this be an MTE Relay Error?
  if (encryptedUrl.length > 2048) {
    throw new Error(
      "The encrypted URL is longer than 2048 characters. Please use a shorter URL."
    );
  }

  // create an object of headers to be JSON stringified and encoded
  const headersToEncode: Record<string, string> = {};

  // always encode content-type
  const contentType = request.headers.get("content-type");
  if (contentType) {
    headersToEncode["content-type"] = contentType;
  }

  // if true, copy all additional headers to be encoded
  if (mteOptions.encodeHeaders === true) {
    request.headers.forEach((value, name) => {
      if (name === "content-type") {
        return;
      }
      headersToEncode[name] = value;
    });
  }

  // if array, copy just those headers to be encoded
  if (Array.isArray(mteOptions.encodeHeaders)) {
    if (mteOptions.encodeHeaders.some((i) => typeof i !== "string")) {
      throw Error(
        `Expected an array of strings for mteOptions.encodeHeaders, but received ${mteOptions.encodeHeaders}.`
      );
    }
    mteOptions.encodeHeaders.forEach((headerName) => {
      if (headerName === "content-type") {
        return;
      }
      const headerValue = request.headers.get(headerName);
      if (headerValue) {
        headersToEncode[headerName] = headerValue;
      }
    });
  }

  const _headers = new Headers(request.headers);

  if (Object.keys(headersToEncode).length > 0) {
    const headersJSON = JSON.stringify(headersToEncode);
    const encodedHeaders = (await mkeEncode(headersJSON, {
      id: `encoder.${serverId}.${pairId}`,
      output: "B64",
      type: mteOptions.encodeType,
    })) as string;
    _headers.set(MTE_ENCODED_HEADERS_HEADER, encodedHeaders);
  }

  // append mte relay client and session IDs
  _headers.set(CLIENT_ID_HEADER, CLIENT_ID!);
  _headers.set(PAIR_ID_HEADER, pairId);
  _headers.set(ENCODER_TYPE_HEADER, mteOptions.encodeType);

  // encode body
  let encryptedBody: ReadableStream<Uint8Array> | Uint8Array | null = null;
  if (request.body !== null) {
    const ab = await request.arrayBuffer();
    const u8 = new Uint8Array(ab);
    const encodedBody = await mkeEncode(u8, {
      id: `encoder.${serverId}.${pairId}`,
      output: "Uint8Array",
      type: mteOptions.encodeType,
    });
    encryptedBody = encodedBody as Uint8Array;
    _headers.set("content-type", "application/octet-stream");
  }

  const _request = new Request(encryptedUrl, {
    // list all properties of request object
    body: encryptedBody,
    cache: "no-cache",
    credentials: request.credentials,
    headers: _headers,
    method: request.method,
    mode: request.mode,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    signal: request.signal,
  });

  return _request;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
