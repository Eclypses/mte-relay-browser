/**
 * Write a cache that maintains a list of MTE Relay Servers this session has communicated with
 */

export type MteRelayRecord = {
  origin: string;
  serverId: string | null;
  status: "pending" | "paired" | "invalid" | "validate";
};

const serverMap = new Map<string, MteRelayRecord>();

export function validateServer(url: string): MteRelayRecord {
  const _url = new URL(url);
  const origin = _url.origin;
  const serverRecord = serverMap.get(origin);

  if (!serverRecord) {
    serverMap.set(origin, {
      origin,
      serverId: null,
      status: "pending",
    });
    return {
      origin,
      serverId: null,
      status: "validate",
    };
  }

  return serverRecord;
}

export function setServerStatus(
  origin: string,
  status: "paired" | "invalid",
  originId?: string
): MteRelayRecord {
  const serverRecord = serverMap.get(origin);
  if (!serverRecord) {
    throw Error(`Server ${origin} not found in cache.`);
  }
  serverRecord.status = status;
  if (originId) {
    serverRecord.serverId = originId;
  }
  return serverRecord;
}
