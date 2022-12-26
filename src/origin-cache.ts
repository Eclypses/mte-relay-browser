import { getValidOrigin } from "./utils/get-valid-origin";

/**
 * Write a cache that maintains a list of Origins this session has communicated with
 * Every minute, review cache and remove entries past certain age (30m?)
 */

export type OriginRecord = {
  origin: string;
  latestUse: number;
  isMteCapable: boolean;
  mteId: string | null;
};

const originMap = new Map<string, OriginRecord>();

/**
 * Register a new MTE module by it's origin.
 */
export function registerOrigin(
  options: Pick<OriginRecord, "isMteCapable" | "origin" | "mteId">
) {
  const _origin = getValidOrigin(options.origin);
  originMap.set(_origin, {
    origin: _origin,
    latestUse: Date.now(),
    isMteCapable: options.isMteCapable,
    mteId: options.mteId || null,
  });
}

/**
 * Refresh an origin's latestUse timestamp
 */
export function refreshOrigin(origin: OriginRecord["origin"]) {
  const _origin = getValidOrigin(origin);
  const module = originMap.get(_origin);
  if (!module) {
    throw Error(`No MTE Module registered with origin of "${_origin}"`);
  }
  module.latestUse = Date.now();
}

/**
 * Check if origin exists
 */
export function getRegisteredOrigin(origin: OriginRecord["origin"]) {
  const _origin = getValidOrigin(origin);
  return originMap.get(_origin);
}

/**
 * Delete a registered MTE module by it's origin.
 */
export function unregisterOrigin(origin: OriginRecord["origin"]) {
  const _origin = getValidOrigin(origin);
  originMap.delete(_origin);
}

/**
 * Check if an origin is registered.
 */
export function isRegisteredOrigin(origin: string) {
  const _origin = getValidOrigin(origin);
  return originMap.has(_origin);
}
