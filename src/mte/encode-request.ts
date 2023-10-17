import {
  CLIENT_ID_HEADER,
  encode,
  ENCODER_TYPE_HEADER,
  MTE_ENCODED_HEADERS_HEADER,
  PAIR_ID_HEADER,
} from "./index";

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
  const encodeHeaders = options.encodeHeaders ?? true;
  if (encodeHeaders) {
    const headersToEncode: Record<string, string> = {};
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
    const headerString = JSON.stringify(headersToEncode);
    itemsToEncode.push({ data: headerString, output: "B64" });
  }

  // get body to encode
  const encodeBody = (options.encodeBody ?? true) && request.body;
  const body = new Uint8Array(await request.arrayBuffer());
  if (encodeBody) {
    itemsToEncode.push({ data: body, output: "Uint8Array" });
  }

  // encode items
  const result = await encode({
    id: `encoder.${options.originId}.${options.pairId}`,
    items: itemsToEncode,
    type: options.type,
  });

  // create new request
  let newRequestUrl = request.url;
  if (encodeUrl) {
    const uriEncoded = encodeURIComponent(result[0] as string);
    newRequestUrl = url.origin + "/" + uriEncoded;
    result.shift();
  }
  const newRequestHeaders = new Headers(request.headers);
  newRequestHeaders.set(CLIENT_ID_HEADER, options.clientId!);
  newRequestHeaders.set(PAIR_ID_HEADER, options.pairId);
  newRequestHeaders.set("content-type", "application/octet-stream");
  newRequestHeaders.set(ENCODER_TYPE_HEADER, options.type);
  if (encodeHeaders) {
    newRequestHeaders.set(MTE_ENCODED_HEADERS_HEADER, result[0] as string);
    result.shift();
  }
  let newRequestBody: string | Uint8Array | null = request.body ? body : null;
  if (encodeBody) {
    newRequestBody = result[0] as string;
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
