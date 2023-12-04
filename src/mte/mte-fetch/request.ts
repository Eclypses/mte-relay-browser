import { MteRelayError } from "../errors";
import {
  CLIENT_ID_HEADER,
  decode,
  encode,
  ENCODER_TYPE_HEADER,
  MTE_ENCODED_HEADERS_HEADER,
  PAIR_ID_HEADER,
} from "../index";
import { formatMteRelayHeader, parseMteRelayHeader } from "./format-mte-info-header";

type EncDecType = "MTE" | "MKE";

export async function encodeRequest(
  request: Request,
  options: {
    clientId: string;
    originId: string;
    pairId: string;
    type: EncDecType;
    encodeUrl?: boolean;
    encodeHeaders?: boolean | string[];
    encodeBody?: boolean;
  }
): Promise<Request> {
  const itemsToEncode: {
    data: string | Uint8Array;
    output: "B64" | "Uint8Array";
  }[] = [];

  // get url to encode
  const url = new URL(request.url);
  const encodeUrl = options.encodeUrl ?? true;
  if (encodeUrl) {
    const route = url.pathname.slice(1) + url.search;
    itemsToEncode.push({ data: route, output: "B64" });
  }

  // get headers to encode
  const headersToEncode: Record<string, string> = {};
  const ct = request.headers.get("content-type");
  if (ct) {
    headersToEncode["content-type"] = ct;
  }
  let encodeHeaders = options.encodeHeaders ?? true;
  if (encodeHeaders) {
    if (Array.isArray(options.encodeHeaders)) {
      for (const header of options.encodeHeaders) {
        const value = request.headers.get(header);
        if (value) {
          headersToEncode[header] = value;
        }
      }
    } else {
      for (const [key, value] of request.headers.entries()) {
        headersToEncode[key] = value;
      }
    }
  }
  if (Object.keys(headersToEncode).length > 0) {
    const headerString = JSON.stringify(headersToEncode);
    itemsToEncode.push({ data: headerString, output: "B64" });
  } else {
    encodeHeaders = false;
  }

  // get body to encode
  const body = new Uint8Array(await request.arrayBuffer());
  const encodeBody = (options.encodeBody ?? true) && body.byteLength > 0;
  if (encodeBody) {
    itemsToEncode.push({ data: body, output: "Uint8Array" });
  }

  // encode items
  const result = await encode({
    id: `encoder.${options.originId}.${options.pairId}`,
    items: itemsToEncode,
    type: options.type,
  });
  // create new request url
  let newRequestUrl = request.url;
  if (encodeUrl) {
    const uriEncoded = encodeURIComponent(result[0] as string);
    newRequestUrl = url.origin + "/" + uriEncoded;
    result.shift();
  }

  // create new request headers
  const newRequestHeaders = new Headers(request.headers);
  newRequestHeaders.set(
    `x-mte-relay`,
    formatMteRelayHeader({
      type: options.type,
      urlIsEncoded: encodeUrl,
      headersAreEncoded: !!encodeHeaders,
      bodyIsEncoded: !!encodeBody,
      bodyEncodeType: "complete",
      clientId: options.clientId,
      pairId: options.pairId,
    })
  );
  newRequestHeaders.set(CLIENT_ID_HEADER, options.clientId!);
  newRequestHeaders.set(PAIR_ID_HEADER, options.pairId);
  newRequestHeaders.set("content-type", "application/octet-stream");
  newRequestHeaders.set(ENCODER_TYPE_HEADER, options.type);
  if (encodeHeaders) {
    newRequestHeaders.set(MTE_ENCODED_HEADERS_HEADER, result[0] as string);
    result.shift();
  }

  // create new request body
  let newRequestBody = request.body ? body : null;
  if (encodeBody) {
    newRequestBody = result[0] as Uint8Array;
  }

  // form new request
  const newRequest = new Request(newRequestUrl, {
    method: request.method,
    headers: newRequestHeaders,
    body: newRequestBody,
    cache: "no-cache",
    credentials: request.credentials,
  });

  return newRequest;
}

export async function decodeRequest(
  request: Request,
  options: {
    clientId: string;
    originId: string;
    pairId: string;
    type: EncDecType;
    encodeUrl?: boolean;
    encodeHeaders?: boolean | string[];
    encodeBody?: boolean;
  }
) {
  const itemsToDecode: {
    data: string | Uint8Array;
    output: "str" | "Uint8Array";
  }[] = [];

  // read header to find out what to decode
  const x = request.headers.get(`x-mte-relay`);
  if (!x) {
    throw new MteRelayError("Missing required header", {
      "missing-header": `x-mte-relay`,
    });
  }
  const mteRelayHeader = parseMteRelayHeader(x);

  // get url to decode
  const url = new URL(request.url);
  if (mteRelayHeader.urlIsEncoded) {
    const route = url.pathname.slice(1);
    itemsToDecode.push({ data: route, output: "str" });
  }

  // get headers to decode
  const header = request.headers.get(MTE_ENCODED_HEADERS_HEADER);
  if (header) {
    itemsToDecode.push({ data: header, output: "str" });
  }

  // get body to encode
  const decodeBody = request.body && mteRelayHeader.bodyIsEncoded;
  if (decodeBody) {
    const body = new Uint8Array(await request.arrayBuffer());
    itemsToDecode.push({ data: body, output: "Uint8Array" });
  }

  // encode items
  const result = await decode({
    id: `decoder.${options.originId}.${options.pairId}`,
    items: itemsToDecode,
    type: options.type,
  });

  // create new url
  let newRequestUrl = request.url;
  if (mteRelayHeader.urlIsEncoded) {
    const uriDecoded = decodeURIComponent(result[0] as string);
    newRequestUrl = url.origin + "/" + uriDecoded;
    result.shift();
  }

  // create new headers
  const newRequestHeaders = new Headers(request.headers);
  newRequestHeaders.delete(CLIENT_ID_HEADER);
  newRequestHeaders.delete(PAIR_ID_HEADER);
  newRequestHeaders.delete(ENCODER_TYPE_HEADER);
  if (mteRelayHeader.headersAreEncoded) {
    const headers: Record<string, string> = JSON.parse(result[0] as string);
    for (const entry of Object.entries(headers)) {
      newRequestHeaders.set(entry[0], entry[1]);
    }
    result.shift();
  }

  // create new body
  let newRequestBody;
  if (mteRelayHeader.bodyIsEncoded && mteRelayHeader.bodyEncodeType === "complete") {
    newRequestBody = result[0] as Uint8Array;
  }
  const newRequest = new Request(newRequestUrl, {
    method: request.method,
    headers: newRequestHeaders,
    body: newRequestBody,
    cache: "no-cache",
    credentials: request.credentials,
  });

  return newRequest;
}
