import { MTE_RELAY_HEADER, encode, MTE_ENCODED_HEADERS_HEADER } from "../index";
import { formatMteRelayHeader } from "./format-mte-info-header";

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
  }
): Promise<Request> {
  const itemsToEncode: {
    data: string | Uint8Array;
    output: "B64" | "Uint8Array";
  }[] = [];

  // get route to encode
  const url = new URL(request.url);
  const encodeUrl = options.encodeUrl ?? true;
  if (encodeUrl) {
    const route = url.pathname.slice(1) + url.search;
    itemsToEncode.push({ data: route, output: "B64" });
  }

  // get headers to encode
  const newRequestHeaders = new Headers(request.headers);
  const headersToEncode: Record<string, string> = {};
  let encodeHeaders = options.encodeHeaders ?? true;
  if (encodeHeaders) {
    if (Array.isArray(options.encodeHeaders)) {
      for (const header of options.encodeHeaders) {
        const value = request.headers.get(header);
        if (value) {
          headersToEncode[header] = value;
          newRequestHeaders.delete(header);
        }
      }
    } else {
      for (const [key, value] of request.headers.entries()) {
        headersToEncode[key] = value;
        newRequestHeaders.delete(key);
      }
    }
  }
  const ct = request.headers.get("content-type");
  if (ct) {
    headersToEncode["content-type"] = ct;
  }
  if (Object.keys(headersToEncode).length > 0) {
    encodeHeaders = true;
    const headerString = JSON.stringify(headersToEncode);
    itemsToEncode.push({ data: headerString, output: "B64" });
  } else {
    encodeHeaders = false;
  }

  // get body to encode
  const body = new Uint8Array(await request.arrayBuffer());
  let bodyIsEncoded = false;
  if (body.byteLength > 0) {
    bodyIsEncoded = true;
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
  newRequestHeaders.set(
    MTE_RELAY_HEADER,
    formatMteRelayHeader({
      type: options.type,
      urlIsEncoded: encodeUrl,
      headersAreEncoded: encodeHeaders,
      bodyIsEncoded: bodyIsEncoded,
      clientId: options.clientId,
      pairId: options.pairId,
    })
  );
  newRequestHeaders.set("content-type", "application/octet-stream");
  if (encodeHeaders) {
    newRequestHeaders.set(MTE_ENCODED_HEADERS_HEADER, result[0] as string);
    result.shift();
  }

  // create new request body
  let newRequestBody = request.body ? body : null;
  if (bodyIsEncoded) {
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
