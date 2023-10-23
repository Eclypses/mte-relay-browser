import {
  instantiateDecoder,
  instantiateEncoder,
  instantiateMteWasm as initWasm,
  decode,
  getNextPairIdFromQueue,
  deleteIdFromQueue,
  encodeRequest,
  CLIENT_ID_HEADER,
  MTE_ENCODED_HEADERS_HEADER,
  PAIR_ID_HEADER,
  ENCODER_TYPE_HEADER,
} from "./mte";
import { setRemoteStatus, getRemoteRecordByOrigin } from "./mte/cache";
import { generateRandomId } from "./utils/generate-id";
import { getEcdh } from "./utils/ecdh";
import { MteRelayError } from "./mte/errors";
import { setCookie, getCookieValue, expireCookie } from "./utils/cookies";

let CLIENT_ID: string | null;
let NUMBER_OF_PAIRS = 5;
let DEFAULT_ENCODE_TYPE: "MTE" | "MKE" = "MKE";

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
  numberOfPairs?: number;
  mtePoolSize?: number;
  mkePoolSize?: number;
  defaultEncodeType?: "MTE" | "MKE";
}) {
  if (options.numberOfPairs) {
    NUMBER_OF_PAIRS = options.numberOfPairs;
  }
  if (options.defaultEncodeType) {
    DEFAULT_ENCODE_TYPE = options.defaultEncodeType;
  }
  await initWasm({
    licenseKey: options.licenseKey,
    companyName: options.licenseCompany,
    mkePoolSize: options.mkePoolSize,
    mtePoolSize: options.mtePoolSize,
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
  let remoteOrigin = "";

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
    remoteOrigin = _url.origin;

    // validate server is MTE Relay server
    let serverRecord = await getRemoteRecordByOrigin(remoteOrigin);

    // init options
    const _mteOptions: MteRequestOptions = {
      encodeHeaders: mteOptions?.encodeHeaders ?? true,
      encodeType: mteOptions?.encodeType || DEFAULT_ENCODE_TYPE,
    };

    // validate remote is MTE Relay Server and pair with it
    if (
      serverRecord.status === "validate-now" ||
      requestOptions?.revalidateServer
    ) {
      try {
        serverRecord = await validateRemoteIsMteRelay(serverRecord.origin);
      } catch (error: any) {
        if (MteRelayError.isMteErrorStatus(error.status)) {
          throw new MteRelayError(
            MteRelayError.getStatusErrorMessages(error.status)!
          );
        } else {
          setRemoteStatus({
            origin: serverRecord.origin,
            status: "invalid",
          });
          throw new Error("Origin is not an MTE Relay server.");
        }
      }
      await pairWithOrigin(serverRecord.origin).catch(() => {
        setRemoteStatus({
          origin: serverRecord.origin,
          status: "invalid",
        });
        throw new Error("Origin is not an MTE Relay server.");
      });
      serverRecord = await setRemoteStatus({
        origin: serverRecord.origin,
        status: "paired",
        clientId: serverRecord.clientId!,
      });
    }

    // if it's pending, recheck every (100 * i)ms
    if (serverRecord.status === "pending") {
      for (let i = 0; i < 20; ++i) {
        await sleep((1 + i) * 100);
        serverRecord = await getRemoteRecordByOrigin(remoteOrigin);
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
    if (!serverRecord.clientId) {
      throw new Error("Origin is not an MTE Relay server.");
    }

    pairId = await getNextPairIdFromQueue(serverRecord.origin);

    /**
     * MTE Encode Headers and Body (if they exist)
     */
    const encodedRequest = await encodeRequest(_request, {
      pairId,
      clientId: serverRecord.clientId,
      type: _mteOptions.encodeType,
      originId: serverRecord.origin,
    });

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

    // save client ID
    CLIENT_ID = response.headers.get(CLIENT_ID_HEADER);
    if (!CLIENT_ID) {
      throw new Error(`Response is missing header: ${CLIENT_ID_HEADER}`);
    }
    setCookie(CLIENT_ID_HEADER, CLIENT_ID);

    // get pair ID from this request/response
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
      const responseDecodedHeadersJson = await decode({
        id: `decoder.${serverRecord.origin}.${responsePairId}`,
        items: [
          {
            data: responseEncodedHeaders,
            output: "str",
          },
        ],
        type: _mteOptions.encodeType,
      });
      const responseDecodedHeaders = JSON.parse(
        responseDecodedHeadersJson[0] as string
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
      const decoded = await decode({
        id: `decoder.${serverRecord.origin}.${responsePairId}`,
        type: _mteOptions.encodeType,
        items: [
          {
            data: u8,
            output: "Uint8Array",
          },
        ],
      });
      decryptedBody = decoded[0] as Uint8Array;
    }

    // return decoded response
    return new Response(decryptedBody, {
      headers: responseHeaders,
      status: response.status,
      statusText: response.statusText,
    });
  } catch (error) {
    if (error instanceof MteRelayError) {
      deleteIdFromQueue({ origin, pairId });
      if (error.status === 566) {
        setRemoteStatus({
          origin: remoteOrigin,
          status: "pending",
        });
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
      pairWithOrigin(remoteOrigin, 1);
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
async function validateRemoteIsMteRelay(origin: string) {
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
  const clientId = response.headers.get(CLIENT_ID_HEADER);
  if (!clientId) {
    throw new Error(`Response is missing header: ${CLIENT_ID_HEADER}`);
  }
  CLIENT_ID = clientId;
  const remoteRecord = await setRemoteStatus({
    origin,
    status: "pending",
    clientId,
  });
  setCookie(CLIENT_ID_HEADER, CLIENT_ID);
  return remoteRecord;
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
      origin: origin,
      entropy: encoderEntropy,
      nonce: pairResponse.decoderNonce,
      personalization: pairInit.encoderPersonalizationStr,
      pairId: pairResponse.pairId,
    });

    await instantiateDecoder({
      entropy: decoderEntropy,
      nonce: pairResponse.encoderNonce,
      personalization: pairInit.decoderPersonalizationStr,
      origin: origin,
      pairId: pairResponse.pairId,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
