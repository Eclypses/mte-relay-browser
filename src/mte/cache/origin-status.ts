import { getCacheItem, setCacheItem } from "./cache";

export type OriginStatus = "paired" | "invalid" | "validate" | "pending";

// Get record by it's origin
export function getOriginStatus(origin: string): OriginStatus {
  const key = prefixKey(origin);
  let record = getCacheItem<OriginStatus>(key);
  if (record) {
    return record;
  }
  setCacheItem(key, "pending");
  return "validate";
}

// set the status of remote machine
export function setOriginStatus(origin: string, status: OriginStatus): void {
  const key = prefixKey(origin);
  setCacheItem(key, status);
}

function prefixKey(key: string) {
  return `origin-status:${key}`;
}
