export function formatMteRelayHeader(options: {
  type: "MTE" | "MKE";
  urlIsEncoded: boolean;
  headersAreEncoded: boolean;
  bodyIsEncoded: boolean;
  bodyEncodeType: "complete" | "stream";
  clientId: string;
  pairId: string;
}) {
  let args = [];
  args.push(options.type);
  args.push(options.urlIsEncoded);
  args.push(options.headersAreEncoded);
  if (options.bodyIsEncoded) {
    args.push(options.bodyEncodeType);
  } else {
    args.push(false);
  }
  args.push(options.clientId);
  args.push(options.pairId);
  return args.join(",");
}

export function parseMteRelayHeader(header: string) {
  const args = header.split(",");
  const type = args[0] as "MTE" | "MKE";
  const urlIsEncoded = args[1] === "true";
  const headersAreEncoded = args[2] === "true";
  const bodyIsEncoded = args[3] === "complete" || args[3] === "stream";
  const bodyEncodeType = args[3] as "complete" | "stream" | false;
  const clientId = args[4];
  const pairId = args[5];
  return {
    type,
    urlIsEncoded,
    headersAreEncoded,
    bodyIsEncoded,
    bodyEncodeType,
    clientId,
    pairId,
  };
}
