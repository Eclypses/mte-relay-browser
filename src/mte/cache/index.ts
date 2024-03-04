export { setEncDecState, getEncDecState } from "./state-cache";
export {
  initializeClientIds,
  getClientId,
  setClientId,
  deleteClientId,
} from "./client-ids";
export {
  getRemoteRecordByOrigin,
  setRemoteStatus,
  addPairIdToQueue,
  getNextPairIdFromQueue,
  deleteIdFromQueue,
} from "./origin-records";
export type { RemoteRecord } from "./origin-records";
