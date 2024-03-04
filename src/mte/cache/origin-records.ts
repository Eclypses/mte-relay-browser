export type RemoteRecord = {
  origin: string;
  clientId: string | null;
  status: "pending" | "paired" | "invalid" | "validate-now";
  pairIdQueue: string[];
};

const cache = new Map();
const serversContacted: string[] = [];

// Get record by it's origin
export function getRemoteRecordByOrigin(origin: string): RemoteRecord {
  let record = cache.get(origin) as RemoteRecord;
  if (!record) {
    if (!serversContacted.includes(origin)) {
      serversContacted.push(origin);
      record = createNewRemoteRecord(origin);
    } else {
      record = {
        origin: origin,
        clientId: null,
        status: "pending",
        pairIdQueue: [],
      };
    }
  }
  return record;
}

/**
 * Set new record as 'pending' for any future callers,
 * but return a record with status of 'validate-now'
 * so the caller can do the work of validating the remote machine
 */
function createNewRemoteRecord(origin: string): RemoteRecord {
  const record: RemoteRecord = {
    origin,
    clientId: null,
    status: "pending",
    pairIdQueue: [],
  };
  cache.set(origin, record);
  return {
    origin,
    clientId: null,
    status: "validate-now",
    pairIdQueue: [],
  };
}

// set the status of remote machine
export function setRemoteStatus(options: {
  origin: string;
  status: "pending" | "paired" | "invalid";
  serverId?: string;
  clientId?: string;
}) {
  const record = getRemoteRecordByOrigin(options.origin);
  if (!record) {
    throw Error(`No record found for origin ${options.origin}.`);
  }
  record.status = options.status;
  if (options.clientId) {
    record.clientId = options.clientId;
  }
  cache.set(options.origin, record);
  return record;
}

/**
 * Adds a pairId to a queue associated with a originId.
 */
export function addPairIdToQueue(options: { origin: string; pairId: string }) {
  const record = getRemoteRecordByOrigin(options.origin);
  if (!record) {
    throw new Error(`No record found for origin ${options.origin}.`);
  }
  record.pairIdQueue.push(options.pairId);
  cache.set(record.origin, record);
}

/**
 * Retrieves and returns the next pairId from the queue associated with the given originId.
 */
export function getNextPairIdFromQueue(origin: string) {
  const record = getRemoteRecordByOrigin(origin);
  if (!record) {
    throw new Error(`No record found for origin ${origin}.`);
  }
  const id = record.pairIdQueue.shift();
  if (!id) {
    throw Error("No ID in queue.");
  }
  record.pairIdQueue.push(id);
  cache.set(record.origin, record);
  return id;
}

/**
 * Deletes a specific pairId from the queue associated with a origin.
 */
export function deleteIdFromQueue(options: { origin: string; pairId: string }) {
  const record = getRemoteRecordByOrigin(options.origin);
  if (!record) {
    throw new Error(`No record found for origin ${options.origin}.`);
  }
  const index = record.pairIdQueue.indexOf(options.pairId);
  if (index > -1) {
    record.pairIdQueue.splice(index, 1);
  }
  cache.set(record.origin, record);
}
