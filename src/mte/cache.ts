// Our current relationship to a remote machine
export type RemoteRecord = {
  origin: string;
  clientId: string | null;
  status: "pending" | "paired" | "invalid" | "validate-now";
  pairIdQueue: string[];
};

// A key:value object that will act as our cache
const cache: Record<string, RemoteRecord | string> = {};

// setter function - can be overridden with adapter
let setCacheItem = async function (key: string, value: RemoteRecord | string) {
  cache[key] = value;
};

// getter function - can be overridden with adapter
let getCacheItem = async function (
  key: string
): Promise<string | RemoteRecord | undefined> {
  return cache[key];
};

export function setCacheFunction(
  get: (key: string) => Promise<string | RemoteRecord | undefined>,
  set: (key: string, value: RemoteRecord | string) => Promise<void>
) {
  getCacheItem = get;
  setCacheItem = set;
}

// Get record by it's origin
export async function getRemoteRecordByOrigin(
  origin: string
): Promise<RemoteRecord> {
  let record = (await getCacheItem(origin)) as RemoteRecord;
  if (!record) {
    record = createNewRemoteRecord(origin);
  }
  return record;
}

/**
 * Set new record as 'pending' for any future callers,
 * but return a record with status of 'validate-now'
 * so the caller can do the work of validating the remote machine
 * @param origin
 * @returns
 */
function createNewRemoteRecord(origin: string): RemoteRecord {
  const record: RemoteRecord = {
    origin,
    clientId: null,
    status: "pending",
    pairIdQueue: [],
  };
  setCacheItem(origin, record);
  return {
    origin,
    clientId: null,
    status: "validate-now",
    pairIdQueue: [],
  };
}

// set the status of remote machine
export async function setRemoteStatus(options: {
  origin: string;
  status: "pending" | "paired" | "invalid";
  serverId?: string;
  clientId?: string;
}) {
  const record = await getRemoteRecordByOrigin(options.origin);
  if (!record) {
    throw Error(`No record found for origin ${options.origin}.`);
  }
  record.status = options.status;
  if (options.clientId) {
    record.clientId = options.clientId;
  }
  await setCacheItem(options.origin, record);
  return record;
}

// save an encoder/decoder state in cache
export async function setEncDecState(id: string, state: string): Promise<void> {
  await setCacheItem(id, state);
}

// get an encoder/decoder state from cache, if it exists
export async function getEncDecState(id: string) {
  return (await getCacheItem(id)) as string | undefined;
}

/**
 * Adds a pairId to a queue associated with a originId.
 *
 * @param {Object} options - The options for adding the pairId to the queue.
 * @param {string} options.origin - The originId.
 * @param {string} options.pairId - The pairId to be added to the queue for that originId.
 */
export async function addPairIdToQueue(options: {
  origin: string;
  pairId: string;
}) {
  const record = await getRemoteRecordByOrigin(options.origin);
  if (!record) {
    throw new Error(`No record found for origin ${options.origin}.`);
  }
  record.pairIdQueue.push(options.pairId);
  await setCacheItem(record.origin, record);
}

/**
 * Retrieves and returns the next pairId from the queue associated with the given originId.
 *
 * @param {string} origin - The origin for which to retrieve the next pairId.
 * @returns {string} The next pairId from the queue.
 */
export async function getNextPairIdFromQueue(origin: string) {
  const record = await getRemoteRecordByOrigin(origin);
  if (!record) {
    throw new Error(`No record found for origin ${origin}.`);
  }
  const id = record.pairIdQueue.shift();
  if (!id) {
    throw Error("No ID in queue.");
  }
  record.pairIdQueue.push(id);
  await setCacheItem(record.origin, record);
  return id;
}

/**
 * Deletes a specific pairId from the queue associated with a origin.
 *
 * @param {Object} options - The options for deleting the pairId from the queue.
 * @param {string} options.origin - The origin from which to delete the pairId.
 * @param {string} options.pairId - The pairId to be deleted from the queue.
 */
export async function deleteIdFromQueue(options: {
  origin: string;
  pairId: string;
}) {
  const record = await getRemoteRecordByOrigin(options.origin);
  if (!record) {
    throw new Error(`No record found for origin ${options.origin}.`);
  }
  const index = record.pairIdQueue.indexOf(options.pairId);
  if (index > -1) {
    record.pairIdQueue.splice(index, 1);
  }
  await setCacheItem(record.origin, record);
}
