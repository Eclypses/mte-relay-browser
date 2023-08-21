# MTE Relay - Browser

The MTE Relay project is meant to automatically detect MTE availability, and use MTE on as many network requests as possible. A server-side MTE Relay must be in use as well.

## Installation

A licensed copy of MTE v3.x.x is a required peer-dependency. Please visit the [Developer's Portal](https://developers.eclypses.com) to get your credentials and download instructions.

Then, install the MTE Relay Browser package:\
`npm i mte-relay-browser`

## Quick Start:

1. Initial MTE WASM module once, as early as possible:

```js
import { instantiateMteWasm } from "mte-relay-browser";

// Initialize MTE WASM module with credentials
await instantiateMteWasm({
  licenseCompany: "COMPANY_NAME_HERE",
  licenseKey: "LICENSE_KEY_HERE",
});
```

2. Use mteFetch() to send encrypted data

```js
import { mteFetch } from "mte-relay-browser";

// use mteFetch to handle encoding data and sending/receiving it
const response = await mteFetch(
  "https://mte-relay-server.example.com/api/login",
  {
    method: "POST",
    body: JSON.stringify({
      email: "john@email.com",
      password: "password",
    }),
  }
);
const data = await response.json();
```

## Initialization

MTE uses a Web Assembly (WASM) module to encode and decode data. You must instantiate the MTE WASM module exactly once, and we recommend doing it as early as possible in your application.

```js
import { instantiateMteWasm } from "mte-relay-browser";

// Initialize MTE WASM module with credentials
await instantiateMteWasm({
  licenseCompany: "COMPANY_NAME_HERE",
  licenseKey: "LICENSE_KEY_HERE",
  numberEncoderDecoderPairs: 5,
  encoderDecoderPoolSize: 5,
});
```

### Options

- `licenseCompany`
  - Type: string
  - Required: true
  - The company name associated with your MTE license
- `licenseKey`
  - Type: string
  - Required: true
  - The license key associated with your MTE license
- `numberEncoderDecoderPairs`
  - Type: number
  - Required: false
  - Default: 5
  - The number of encoder/decoder pairs to create. Each pair can encode/decode one request at a time.
- `encoderDecoderPoolSize`
  - Type: number
  - Required: false
  - Default: 5
  - The number of encoder/decoder pairs to keep in the pool. This should be less than or equal to the number of encoder/decoder pairs.

## Using mteFetch()

The library exports a function called `mteFetch` that accepts the same arguments as the native [fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch) in modern browsers. However, unlike a normal fetch, it will first attempt to establish a connection with a server-side MTE relay, and then MTE encrypt all data sent between the two end points. Encrypting and Decrypting data is handled automatically, and mteFetch can be used as a normal fetch.

```js
import { mteFetch } from "mte-relay-browser";

// use mteFetch to handle encoding data and sending/receiving it
const response = await mteFetch(
  "https://mte-relay-server.example.com/api/login",
  {
    method: "POST",
    body: JSON.stringify({
      email: "john@email.com",
      password: "password",
    }),
  }
);
const data = await response.json();
```

> Note: This library is designed to only communicate with a properly configured [MTE Relay Server](https://www.npmjs.com/package/mte-relay-server).

### MTE Options

mteFetch() accepts three arguments:\
`mteFetch(url, options, mteOptions)`

The third argument, `mteOptions`, is an object that can be used to configure MTE functionality for that specific request. Review the options below.

- `encodeHeaders`
  - Type: boolean | string[]
  - Default: true
  - If true, all headers passed to the mteFetch options object will be encoded. If false, no headers will be encoded. If an array of strings, only the headers in the array will be encoded.

Example:

```js
mteFetch('/api/admin/new-user', {
  headers: {
    authorization: 'bearer 123456'
  },
  method: 'POST',
  body: JSON.stringify({
    email: 'user01@email.com',
    password: 'P@ssw0rd!'
}, {
  encodeHeaders: true
});
```
