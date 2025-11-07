# MTE Relay - Client

MTE Relay Client is one half of an end-to-end encryption system that protects all network requests with next-generation application data security, on prem or in the cloud. MTE Relay Client provides a wrapper around a `fetch`-compatible API, making it suitable for any JavaScript environment, including modern browsers and Node.js. Simply initialize the MTE Relay client, then use the `mteFetch` API to send end-to-end encrypted data to an [MTE Relay Server](https://www.npmjs.com/package/mte-relay-server).

## Installation

A licensed copy of MTE v4.x.x is a required peer-dependency. Please log into the [Eclypses Developer's Portal](https://developers.eclypses.com) to get your credentials and download instructions.

Then, install the MTE Relay Client package:

```bash
npm i mte-relay-client
```

## Quick Start

1.  Initialize the MTE Relay Client once, as early as possible in your application's lifecycle:

```ts
import { initMteRelayClient } from "mte-relay-client";

// Initialize the MTE Relay Client with your credentials
await initMteRelayClient({
  licenseCompany: "COMPANY_NAME_HERE",
  licenseKey: "LICENSE_KEY_HERE",
});
```

2.  Use `mteFetch()` to send and receive encrypted data:

```ts
import { mteFetch } from "mte-relay-client";

// Use mteFetch just like the standard fetch API
const response = await mteFetch(
  "https://mte-relay-server.example.com/api/login",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "john@email.com",
      password: "password",
    }),
  }
);

// The response body is automatically decrypted
const data = await response.json();
```

## Initialization

MTE uses a Web Assembly (WASM) module to perform cryptographic operations. You must initialize the MTE Relay Client exactly once before making any `mteFetch` calls.

```ts
import { initMteRelayClient } from "mte-relay-client";

// Initialize MTE WASM module with credentials and custom options
await initMteRelayClient({
  licenseCompany: "COMPANY_NAME_HERE",
  licenseKey: "LICENSE_KEY_HERE",
  numberOfPairs: 5, // optional, default 5
  mtePoolSize: 2, // optional, default 2
  mkePoolSize: 5, // optional, default 5
  encodeType: "MKE", // optional, default "MKE"
  encodeUrls: true, // optional, default true
  encodeHeaders: true, // optional, default true
  pathPrefix: "", // optional, default ""
});
```

### Options

- `licenseCompany`
  - **Required**
  - Type: `string`
  - The company name associated with your MTE license.
- `licenseKey`
  - **Required**
  - Type: `string`
  - The license key associated with your MTE license.
- `numberOfPairs`
  - Type: `number`
  - Default: `5`
  - The number of encoder/decoder pairs to create when pairing with an MTE Relay server.
- `mtePoolSize`
  - Type: `number`
  - Default: `2`
  - How many MTE encoder/decoder objects to hold in memory to be ready for use.
- `mkePoolSize`
  - Type: `number`
  - Default: `5`
  - How many MKE encoder/decoder objects to hold in memory to be ready for use.
- `encodeType`
  - Type: `"MTE" | "MKE"`
  - Default: `"MKE"`
  - The default encode type to use on all requests.
- `encodeUrls`
  - Type: `boolean`
  - Default: `true`
  - When `true`, URLs will be encoded by default on all requests.
- `encodeHeaders`
  - Type: `boolean | string[]`
  - Default `true`
  - When `true`, all custom headers are encoded. When an array of strings is provided, only headers with matching keys are encoded. When `false`, headers are not encoded.
- `pathPrefix`
  - Type: `string`
  - Default `""`
  - A string prefix that will not be encoded and will be prepended to the request's pathname. This is useful for reverse-proxy routing.
- `storage`
  - Type: `MteRelayStorage`
  - Default: `LocalStorageWrapper` in browsers, `MemoryStorage` otherwise.
  - An object for persisting the client ID across sessions. The library automatically uses `localStorage` in browsers. For server-side environments, it defaults to in-memory storage, or you can provide a custom implementation (e.g., to use a database).
- `fetch`
  - Type: `typeof fetch`
  - Default: The global `fetch` function.
  - A `fetch`-compatible function for making HTTP requests. This is necessary in environments where `fetch` is not globally available, such as older versions of Node.js.

## Server-Side Usage (Node.js)

To use this library in a Node.js &lt; v21 environment, you must provide a `fetch` implementation. You may also provide a storage mechanism if you need to persist the client ID.

```bash
npm i node-fetch
```

```ts
import { initMteRelayClient, MemoryStorage } from "mte-relay-client";
import fetch from "node-fetch";

await initMteRelayClient({
  licenseCompany: "COMPANY_NAME_HERE",
  licenseKey: "LICENSE_KEY_HERE",
  // Provide a fetch implementation for Node.js
  fetch: fetch,
  // Use in-memory storage for the client ID on the server
  storage: new MemoryStorage(),
});
```

## Using `mteFetch()`

The `mteFetch` function mirrors the standard `fetch` API but adds end-to-end protection. It automatically handles pairing with the server, establishing secure states, and encrypting/decrypting request and response data.

> **Note:** This library is designed to communicate exclusively with a properly configured [MTE Relay Server](https://www.npmjs.com/package/mte-relay-server). You must point your requests to your MTE Relay Server instance, not directly to your backend services.

```ts
import { mteFetch } from "mte-relay-client";

const response = await mteFetch(
  "https://mte-relay-server.example.com/api/data",
  {
    method: "POST",
    body: JSON.stringify({
      email: "john@email.com",
      password: "P@ssw0rd!",
    }),
  }
);
const data = await response.json();
```

### MTE Options

`mteFetch()` accepts an optional third argument, `mteOptions`, to configure MTE behavior for a specific request. These settings override the defaults provided during `initMteRelayClient`.

`mteFetch(url, [options,] [mteOptions])`

- `encodeType`
  - Type: `"MTE" | "MKE"`
- `encodeUrl`
  - Type: `boolean`
- `encodeHeaders`
  - Type: `boolean | string[]`
- `pathPrefix`
  - Type: `string`
- `useStreaming`
  - Type: `boolean`
  - Default: `true`
  - Streaming is the most performant way to handle request and response bodies. In the rare case that you need to follow a redirect, you may need to set `useStreaming: false` for that specific request.

**Example:**

```ts
mteFetch(
  "/api/admin/new-user",
  {
    headers: {
      authorization: "bearer 123456",
    },
    method: "POST",
    body: JSON.stringify({
      email: "user01@email.com",
      password: "P@ssw0rd!",
    }),
  },
  {
    encodeType: "MTE",
    encodeHeaders: ["authorization"], // Only encode the authorization header
    encodeUrl: true,
    pathPrefix: "/mte-relay",
    useStreaming: true,
  }
);
```

## Q & A

#### What is MTE and what is MKE?

**MicroToken Exchange (MTE)** is a next-generation, patented, quantum-resistant data protection technology that replaces your data with random streams of values. For every byte of real data, multiple bytes of random data are generated to replace it. Since replacement tokens are randomly generated, the encoded output is different every time, even for the same input. This makes MTE the most secure option, though it results in larger data sizes.

**Managed Key Encryption (MKE)** is a method that uses MTE to securely generate and exchange random, single-use encryption keys. Your data is then encrypted using industry-leading AES-256 GCM. Keys are generated on both sides of the communication and are never sent over the network. A unique key is generated for each new encryption, so the encrypted output is different every time.

#### When should I use MTE or MKE?

- Use **MTE** when protecting small (<5kb), highly sensitive data like passwords, payment details, or protected personal information. Its replacement scheme offers the highest level of security at the cost of increased data size.
- Use **MKE** for most general-purpose network communication. It is highly secure, performant, and capable of handling large payloads or file streams efficiently.

#### What are encoder/decoder pairs?

Encoders and decoders have a one-to-one relationship; a specific encoder can only be decrypted by its paired decoder. To facilitate a round-trip request, two pairs are needed: one for the client-to-server request and another for the server-to-client response.

To handle concurrent requests in high-traffic applications, the library creates a pool of these pairs and distributes requests among them in a round-robin fashion. The default of 5 pairs is suitable for most applications. If you encounter concurrency errors, you can increase this value via the `numberOfPairs` option in `initMteRelayClient`.

#### What are `mtePoolSize` and `mkePoolSize`?

These options control the number of pre-initialized MTE and MKE encoder/decoder objects held in memory. Keeping these objects ready in a pool improves performance by avoiding the overhead of creating them on-demand. Generally, `mkePoolSize` should match `numberOfPairs`. Since MTE is often used less frequently, `mtePoolSize` can be lower.

#### How does error handling work?

MTE Relay Client has a built-in resilience mechanism. If it detects specific server-side errors, such as a lost session state (e.g., due to a server restart), it will automatically attempt to re-establish a secure session and retry the failed request once. This handles transient network and state issues gracefully without requiring manual intervention in your application code.
