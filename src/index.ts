import {
  instantiateDecoder,
  instantiateEncoder,
  instantiateMteWasm as initWasm,
  getNextPairIdFromQueue,
  deleteIdFromQueue,
  encodeRequest,
  MTE_RELAY_HEADER,
  parseMteRelayHeader,
  getKyberInitiator,
} from "./mte";
import { setRemoteStatus, getRemoteRecordByOrigin } from "./mte/cache";
import { generateRandomId } from "./utils/generate-id";
import { MteRelayError } from "./mte/errors";
import { setCookie, getCookieValue, expireCookie } from "./utils/cookies";
import { decodeResponse } from "./mte/mte-fetch/response";

let CLIENT_ID: string | null;
let NUMBER_OF_PAIRS = 5;
let DEFAULT_ENCODE_TYPE: "MTE" | "MKE" = "MKE";
const CLIENT_ID_COOKIE = "mteclientid";

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
  const clientId = getCookieValue(CLIENT_ID_COOKIE);
  if (clientId) {
    CLIENT_ID = clientId;
  }
}

type MteRequestOptions = {
  encodeUrl: boolean;
  encodeHeaders: boolean | string[];
  encodeType: "MTE" | "MKE";
};

// send encoded request
// if it throws an MTE error, try again 1 time
export async function mteFetch(
  url: RequestInfo,
  options?: RequestInit,
  mteOptions?: Partial<MteRequestOptions>
) {
  return await sendMteRequest(url, options, mteOptions);
}

// export network request function
async function sendMteRequest(
  url: RequestInfo,
  options?: RequestInit,
  mteOptions?: Partial<MteRequestOptions>,
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
      encodeUrl: mteOptions?.encodeUrl ?? true,
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
      await pairWithOrigin(serverRecord.origin).catch((error) => {
        setRemoteStatus({
          origin: serverRecord.origin,
          status: "invalid",
        });
        throw error;
      });
      serverRecord = await setRemoteStatus({
        origin: serverRecord.origin,
        status: "paired",
        clientId: serverRecord.clientId!,
      });
    }

    // if it's pending, recheck every (100 * i)ms
    if (serverRecord.status === "pending") {
      for (let i = 1; i < 20; ++i) {
        await sleep(i * 100);
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
      type: _mteOptions.encodeType,
      originId: serverRecord.origin,
      clientId: serverRecord.clientId,
      encodeUrl: _mteOptions.encodeUrl,
      encodeHeaders: _mteOptions.encodeHeaders,
    });

    /**
     * Send the request
     */
    let response = await fetch(encodedRequest);
    if (!response.ok) {
      if (MteRelayError.isMteErrorStatus(response.status)) {
        const msg = MteRelayError.getStatusErrorMessages(response.status);
        if (msg) {
          throw new MteRelayError(msg);
        }
      }
    }

    // parse header for clientId, then save it as a cookie
    const mteRelayHeader = response.headers.get(MTE_RELAY_HEADER);
    if (!mteRelayHeader) {
      throw new Error("Origin is not an MTE Relay server.");
    }
    const parsedRelayHeaders = parseMteRelayHeader(mteRelayHeader);
    if (!parsedRelayHeaders.clientId) {
      throw new Error(`Response is missing clientId header`);
    }
    setCookie(CLIENT_ID_COOKIE, parsedRelayHeaders.clientId);

    // decode response
    const decodedResponse = await decodeResponse(response, {
      decoderId: `decoder.${serverRecord.origin}.${parsedRelayHeaders.pairId}`,
    });
    return decodedResponse;
  } catch (error) {
    if (error instanceof MteRelayError) {
      // serverside secret changed, revalidate server
      if (error.status === 566) {
        setRemoteStatus({
          origin: remoteOrigin,
          status: "pending",
        });
        CLIENT_ID = null;
        expireCookie(CLIENT_ID_COOKIE);
        if (requestOptions?.isLastAttempt) {
          throw new Error("Origin is not an MTE Relay server.");
        }
        return await sendMteRequest(url, options, mteOptions, {
          revalidateServer: true,
          isLastAttempt: true,
        });
      }

      // replace this pair with a new one
      deleteIdFromQueue({ origin, pairId });
      pairWithOrigin(remoteOrigin, 1);
      if (!requestOptions?.isLastAttempt) {
        return await sendMteRequest(url, options, mteOptions, {
          isLastAttempt: true,
        });
      }
    }

    // else return error
    let message = "An unknown error occurred.";
    if (error instanceof Error) {
      throw error;
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
    _headers[MTE_RELAY_HEADER] = CLIENT_ID;
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
  const mteRelayHeaders = response.headers.get(MTE_RELAY_HEADER);
  if (!mteRelayHeaders) {
    throw new Error("Origin is not an MTE Relay origin.");
  }
  const parsedRelayHeaders = parseMteRelayHeader(mteRelayHeaders);
  if (!parsedRelayHeaders.clientId) {
    throw new Error(`Response is missing clientId from header.`);
  }
  CLIENT_ID = parsedRelayHeaders.clientId;
  const remoteRecord = await setRemoteStatus({
    origin,
    status: "pending",
    clientId: parsedRelayHeaders.clientId,
  });
  setCookie(CLIENT_ID_COOKIE, CLIENT_ID);
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
  const kyber = [];

  let i = 0;
  const iMax = numberOfPairs || NUMBER_OF_PAIRS;
  for (; i < iMax; ++i) {
    const pairId = generateRandomId();
    const encoderPersonalizationStr = generateRandomId();
    const encoderKyber = getKyberInitiator();
    const decoderPersonalizationStr = generateRandomId();
    const decoderKyber = getKyberInitiator();

    initValues.push({
      pairId,
      encoderPersonalizationStr,
      encoderPublicKey: encoderKyber.publicKey,
      decoderPersonalizationStr,
      decoderPublicKey: decoderKyber.publicKey,
    });

    kyber.push({ encoderKyber, decoderKyber });
  }

  const _headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  _headers[MTE_RELAY_HEADER] = CLIENT_ID;

  const response = await fetch(`${origin}/api/mte-pair`, {
    method: "POST",
    headers: _headers,
    credentials: "include",
    body: JSON.stringify(initValues),
  });
  if (!response.ok) {
    throw new Error("Failed to pair with server MTE Translator.");
  }
  const mteRelayHeaders = response.headers.get(MTE_RELAY_HEADER);
  if (!mteRelayHeaders) {
    throw new Error(`Response is missing header: ${MTE_RELAY_HEADER}`);
  }
  const parsedRelayHeaders = parseMteRelayHeader(mteRelayHeaders);
  setCookie(CLIENT_ID_COOKIE, parsedRelayHeaders.clientId);

  // convert response to json
  const pairResponseData: {
    pairId: string;
    encoderSecret: string;
    encoderNonce: string;
    decoderSecret: string;
    decoderNonce: string;
  }[] = await response.json();

  let j = 0;
  for (; j < pairResponseData.length; ++j) {
    const pairInit = initValues[j];
    const pairResponse = pairResponseData[j];
    const _kyber = kyber[j];

    // create entropy
    const encoderEntropy = _kyber.encoderKyber.decryptSecret(
      pairResponse.decoderSecret
    );
    const decoderEntropy = _kyber.decoderKyber.decryptSecret(
      pairResponse.encoderSecret
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
