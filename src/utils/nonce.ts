export function makeNonce() {
  return Math.floor(Math.random() * 1e15).toString();
}
