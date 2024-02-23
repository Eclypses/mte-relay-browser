import { MteRelayError } from "../errors";
import { MTE_ENCODED_HEADERS_HEADER, decode } from "../index";
import { parseMteRelayHeader } from "./format-mte-info-header";

export async function decodeResponse(
  response: Response,
  options: {
    decoderId: string;
  }
) {
  // read header to find out what to decode
  const x = response.headers.get(`x-mte-relay`);
  if (!x) {
    throw new MteRelayError("Missing required header", {
      "missing-header": `x-mte-relay`,
    });
  }
  const relayOptions = parseMteRelayHeader(x);

  // store items that should be decoded
  const itemsToDecode: {
    data: string | Uint8Array;
    output: "str" | "Uint8Array";
  }[] = [];

  // get headers to decode
  if (relayOptions.headersAreEncoded) {
    const header = response.headers.get(MTE_ENCODED_HEADERS_HEADER);
    if (header) {
      itemsToDecode.push({ data: header, output: "str" });
    }
  }

  // get body to decode
  if (relayOptions.bodyIsEncoded && !!response.body) {
    const u8 = new Uint8Array(await response.arrayBuffer());
    itemsToDecode.push({ data: u8, output: "Uint8Array" });
  }

  // decode items
  const result = await decode({
    id: options.decoderId,
    items: itemsToDecode,
    type: relayOptions.type,
  });

  // create new response headers
  const newHeaders = new Headers(response.headers);
  if (relayOptions.headersAreEncoded) {
    newHeaders.delete(MTE_ENCODED_HEADERS_HEADER);
    const headers: Record<string, string> = JSON.parse(result[0] as string);
    for (const entry of Object.entries(headers)) {
      newHeaders.set(entry[0], entry[1]);
    }
  }

  // create new response body
  let newBody: BodyInit | undefined = response.body || undefined;
  if (relayOptions.bodyIsEncoded) {
    newBody = result[1] as Uint8Array;
  }

  // form new response
  const newResponse = new Response(newBody, {
    headers: newHeaders,
    status: response.status,
    statusText: response.statusText,
  });

  return newResponse;
}
