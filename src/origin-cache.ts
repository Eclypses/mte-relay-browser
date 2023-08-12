import { getValidOrigin } from "./utils/get-valid-origin";

/**
 * Write a cache that maintains a list of MTE Relay Servers this session has communicated with
 */

export type MteRelayRecord = {
  origin: string;
  serverId: string;
};

const mteRelayMap = new Map<string, MteRelayRecord>();

/**
 * Register a new MTE Relay server by it's origin.
 */
export function registerOrigin(options: {
  origin: RequestInfo | URL;
  serverId: string;
}) {
  const _origin = getValidOrigin(options.origin);
  let record: MteRelayRecord = {
    origin: _origin,
    serverId: options.serverId,
  };
  mteRelayMap.set(_origin, record);
  return record;
}

/**
 * Check if MTE Relay server exists
 */
export function getRegisteredOrigin(origin: RequestInfo | URL) {
  const _origin = getValidOrigin(origin);
  return mteRelayMap.get(_origin);
}

/**
 * Delete a registered MTE Relay server by it's origin.
 */
export function unregisterOrigin(origin: RequestInfo | URL) {
  const _origin = getValidOrigin(origin);
  mteRelayMap.delete(_origin);
}
