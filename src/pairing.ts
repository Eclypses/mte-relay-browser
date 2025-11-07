/**
 * This file contains the logic for validating and pairing with an MTE Relay server.
 * It handles the initial handshake to verify the server's identity and then
 * establishes the encrypted communication channels (pairs) used for subsequent
 * requests.
 */

import { MTE_RELAY_HEADER } from "./constants";
import { getClientId, setClientId, setOriginStatus } from "./cache";
import { config, _fetch } from "./config";
import { MteRelayError } from "./errors";
import { instantiateDecoder, instantiateEncoder } from "./mte-helpers";
import { getRandomStr, getKyberInitiator, parseMteRelayHeader } from "./utils";

/**
 * Validates that a remote origin is an MTE Relay server.
 * @param {string} origin The origin URL to validate.
 */
export async function validateRemoteIsMteRelay(origin: string): Promise<void> {
  const headers = new Headers();
  const clientId = await getClientId(origin);
  if (clientId) {
    headers.set(MTE_RELAY_HEADER, clientId);
  }
  const response = await _fetch(`${origin}${config.pathPrefix}/api/mte-relay`, {
    method: "HEAD",
    headers,
  });

  if (MteRelayError.isMteErrorStatus(response.status)) {
    throw new MteRelayError(
      MteRelayError.getStatusErrorMessages(response.status)!,
      { status: response.status }
    );
  }
  if (!response.ok) {
    throw new Error("Origin is not an MTE Relay origin: Response not OK.");
  }
  const mteRelayHeaders = response.headers.get(MTE_RELAY_HEADER);
  if (!mteRelayHeaders) {
    throw new Error("Origin is not an MTE Relay origin: Missing header.");
  }
  const parsedRelayHeaders = parseMteRelayHeader(mteRelayHeaders);
  await setClientId(origin, parsedRelayHeaders.clientId);
  setOriginStatus(origin, "pending");
}

/**
 * Establishes MTE encoder/decoder pairs with the MTE Relay server.
 * @param {string} origin The origin URL to pair with.
 * @param {number} [numberOfPairs] The number of pairs to create.
 */
export async function pairWithOrigin(
  origin: string,
  numberOfPairs?: number
): Promise<void> {
  const clientId = await getClientId(origin);
  if (!clientId) {
    throw new Error("Client ID is not set for pairing.");
  }

  const iMax = numberOfPairs || config.numberOfPairs;
  const initValues = [];
  const kyberPairs = [];

  for (let i = 0; i < iMax; ++i) {
    const encoderKyber = getKyberInitiator();
    const decoderKyber = getKyberInitiator();
    initValues.push({
      pairId: getRandomStr(),
      encoderPersonalizationStr: getRandomStr(),
      encoderPublicKey: encoderKyber.publicKey,
      decoderPersonalizationStr: getRandomStr(),
      decoderPublicKey: decoderKyber.publicKey,
    });
    kyberPairs.push({ encoderKyber, decoderKyber });
  }

  const response = await _fetch(`${origin}${config.pathPrefix}/api/mte-pair`, {
    headers: {
      [MTE_RELAY_HEADER]: clientId,
      "Content-Type": "application/json",
    },
    method: "POST",
    body: JSON.stringify(initValues),
  });

  if (!response.ok) {
    throw new Error("Failed to pair with server: Response not OK.");
  }
  const mteRelayHeaders = response.headers.get(MTE_RELAY_HEADER);
  if (!mteRelayHeaders) {
    throw new Error(`Response is missing header: ${MTE_RELAY_HEADER}`);
  }
  const parsedRelayHeaders = parseMteRelayHeader(mteRelayHeaders);
  await setClientId(origin, parsedRelayHeaders.clientId);

  const pairResponseData: {
    pairId: string;
    encoderSecret: string;
    encoderNonce: string;
    decoderSecret: string;
    decoderNonce: string;
  }[] = await response.json();

  for (let j = 0; j < pairResponseData.length; ++j) {
    const { encoderKyber, decoderKyber } = kyberPairs[j];
    const pairInit = initValues[j];
    const pairResponse = pairResponseData[j];

    const encoderEntropy = encoderKyber.decryptSecret(
      pairResponse.decoderSecret
    );
    const decoderEntropy = decoderKyber.decryptSecret(
      pairResponse.encoderSecret
    );

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
