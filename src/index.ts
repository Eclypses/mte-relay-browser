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
import {
  setRemoteStatus,
  getRemoteRecordByOrigin,
  initializeClientIds,
  getClientId,
  setClientId,
  deleteClientId,
} from "./mte/cache";
import { generateRandomId } from "./utils/generate-id";
import { MteRelayError } from "./mte/errors";
import { decodeResponse } from "./mte/mte-fetch/response";

let NUMBER_OF_PAIRS = 5;
let DEFAULT_ENCODE_TYPE: "MTE" | "MKE" = "MKE";
let DEFAULT_ENCODE_URL = true;
let DEFAULT_ENCODE_HEADERS: boolean | string[] = true;

/**
 * Initialize the MTE Relay Client with default values.
 *
 * @param {string} options.licenseKey - The license key for the MTE module.
 * @param {string} options.licenseCompany - The name of the licensing company.
 * @param {number} [options.numberOfPairs] - Number of encoder/decoder pairs to create with MTE Relay Servers. Defaults to 5.
 * @param {number} [options.mtePoolSize] - How many MTE encoder/decoder objects to hold in memory. Defaults 3.
 * @param {number} [options.mkePoolSize] - How many MKE encoder/decoder objects to hold in memory. Defaults 6.
 * @param {string} [options.defaultEncodeType] - The default encoding type to use. Defaults to "MKE".
 * @param {boolean} [options.encodeUrls] - The default encode URL option. Defaults to true.
 * @param {boolean | string[]} [options.encodeHeaders] - The default encode headers option. Defaults to true.
 * @returns {Promise<void>} A promise that resolves once the MTE Relay is initialized.
 */
export async function initMteRelayClient(options: {
  licenseKey: string;
  licenseCompany: string;
  numberOfPairs?: number;
  mtePoolSize?: number;
  mkePoolSize?: number;
  defaultEncodeType?: "MTE" | "MKE";
  encodeUrls?: boolean;
  encodeHeaders?: boolean | string[];
}) {
  if (options.numberOfPairs) {
    NUMBER_OF_PAIRS = options.numberOfPairs;
  }
  if (options.defaultEncodeType) {
    DEFAULT_ENCODE_TYPE = options.defaultEncodeType;
  }
  if (options.encodeUrls !== undefined) {
    DEFAULT_ENCODE_URL = options.encodeUrls;
  }
  if (options.encodeHeaders !== undefined) {
    DEFAULT_ENCODE_HEADERS = options.encodeHeaders;
  }
  initializeClientIds();
  await initWasm({
    licenseKey: options.licenseKey,
    companyName: options.licenseCompany,
    mkePoolSize: options.mkePoolSize,
    mtePoolSize: options.mtePoolSize,
  });
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
      encodeUrl: mteOptions?.encodeUrl ?? DEFAULT_ENCODE_URL,
      encodeHeaders: mteOptions?.encodeHeaders ?? DEFAULT_ENCODE_HEADERS,
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
    setClientId(serverRecord.origin, parsedRelayHeaders.clientId);

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
        deleteClientId(remoteOrigin);
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
  const headers = new Headers();
  const clientId = getClientId(origin);
  if (clientId) {
    headers.set(MTE_RELAY_HEADER, clientId);
  }
  const response = await fetch(origin + "/api/mte-relay", {
    method: "HEAD",
    headers,
  });

  if (MteRelayError.isMteErrorStatus(response.status)) {
    throw new MteRelayError(
      MteRelayError.getStatusErrorMessages(response.status)!
    );
  }

  if (!response.ok) {
    throw new Error("Origin is not an MTE Relay origin. Response not ok.");
  }
  const mteRelayHeaders = response.headers.get(MTE_RELAY_HEADER);
  if (!mteRelayHeaders) {
    throw new Error(
      "Origin is not an MTE Relay origin. Response missing header."
    );
  }
  const parsedRelayHeaders = parseMteRelayHeader(mteRelayHeaders);
  if (!parsedRelayHeaders.clientId) {
    throw new Error(
      `Response is missing clientId from header. Response missing ClientId.`
    );
  }
  setClientId(origin, parsedRelayHeaders.clientId);
  const remoteRecord = await setRemoteStatus({
    origin,
    status: "pending",
    clientId: parsedRelayHeaders.clientId,
  });
  return remoteRecord;
}

/**
 * Pair with Server MTE Translator
 */
async function pairWithOrigin(origin: string, numberOfPairs?: number) {
  const clientId = getClientId(origin);
  if (!clientId) {
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

  const response = await fetch(`${origin}/api/mte-pair`, {
    headers: {
      [MTE_RELAY_HEADER]: clientId,
      "Content-Type": "application/json",
    },
    method: "POST",
    body: JSON.stringify(initValues),
  });
  if (!response.ok) {
    throw new Error(
      "Failed to pair with server MTE Translator. Response not ok."
    );
  }
  const mteRelayHeaders = response.headers.get(MTE_RELAY_HEADER);
  if (!mteRelayHeaders) {
    throw new Error(`Response is missing header: ${MTE_RELAY_HEADER}`);
  }
  const parsedRelayHeaders = parseMteRelayHeader(mteRelayHeaders);
  setClientId(origin, parsedRelayHeaders.clientId);

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
