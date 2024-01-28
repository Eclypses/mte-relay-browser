import { MteRelayError } from "../errors";
import { MTE_ENCODED_HEADERS_HEADER, decode, encode } from "../index";
import {
  formatMteRelayHeader,
  parseMteRelayHeader,
} from "./format-mte-info-header";

export async function encodeResponse(
  response: Response,
  options: {
    clientId: string;
    originId: string;
    pairId: string;
    type: "MTE" | "MKE";
    encodeUrl?: boolean;
    encodeHeaders?: boolean | string[];
    encodeBody?: boolean;
  }
): Promise<Response> {
  const itemsToEncode: {
    data: string | Uint8Array;
    output: "B64" | "Uint8Array";
  }[] = [];

  // get headers to encode
  const headersToEncode: Record<string, string> = {};
  const ct = response.headers.get("content-type");
  if (ct) {
    headersToEncode["content-type"] = ct;
  }
  let encodeHeaders = options.encodeHeaders ?? true;
  if (encodeHeaders) {
    if (Array.isArray(options.encodeHeaders)) {
      for (const header of options.encodeHeaders) {
        const value = response.headers.get(header);
        if (value) {
          headersToEncode[header] = value;
        }
      }
    } else {
      for (const [key, value] of response.headers.entries()) {
        headersToEncode[key] = value;
      }
    }
    const headerString = JSON.stringify(headersToEncode);
    itemsToEncode.push({ data: headerString, output: "B64" });
  }
  if (Object.keys(headersToEncode).length > 0) {
    const headerString = JSON.stringify(headersToEncode);
    itemsToEncode.push({ data: headerString, output: "B64" });
  } else {
    encodeHeaders = false;
  }

  // encode body
  const encodeBody = (options.encodeBody ?? true) && response.body;
  const body = new Uint8Array(await response.arrayBuffer());
  if (encodeBody) {
    itemsToEncode.push({ data: body, output: "Uint8Array" });
  }

  // encode items
  const result = await encode({
    id: `encoder.${options.originId}.${options.pairId}`,
    items: itemsToEncode,
    type: options.type,
  });

  // create new response headers
  const newHeaders = new Headers(response.headers);
  newHeaders.set("content-type", "application/octet-stream");
  newHeaders.set(
    `x-mte-relay`,
    formatMteRelayHeader({
      type: options.type,
      urlIsEncoded: false,
      headersAreEncoded: !!encodeHeaders,
      bodyIsEncoded: !!encodeBody,
      clientId: options.clientId,
      pairId: options.pairId,
    })
  );

  // create new response body
  let newBody = response.body ? body : null;
  if (encodeBody) {
    newBody = result[0] as Uint8Array;
  }

  // form new response
  const newResponse = new Response(newBody, {
    headers: newHeaders,
    status: response.status,
    statusText: response.statusText,
  });

  return newResponse;
}

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
  if (relayOptions.bodyIsEncoded) {
    if (response.body) {
      const u8 = new Uint8Array(await response.arrayBuffer());
      itemsToDecode.push({ data: u8, output: "Uint8Array" });
    }
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
