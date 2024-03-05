# MTE Relay - Browser

MTE Relay Browser is one half of an end-to-end encryption system that protects all network requests with next-generation application data security, on prem or in the cloud. MTE Relay Browser provides a wrapper around the native [fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch) available in all modern browsers. Simply initialize the MTE Relay client, then use the `mteFetch` API to send end-to-end encrypted data to an [MTE Relay Server](https://www.npmjs.com/package/mte-relay-server).

## Installation

A licensed copy of MTE v4.x.x is a required peer-dependency. Please log into the [Eclypses Developer's Portal](https://developers.eclypses.com) to get your credentials and download instructions.

Then, install the MTE Relay Browser package:\
`npm i mte-relay-browser`

## Quick Start:

1. Initialize the MTE Relay Client once, as early as possible:

```js
import { initMteRelayClient } from "mte-relay-browser";

// Initialize the MTE Relay Client with credentials
await initMteRelayClient({
  licenseCompany: "COMPANY_NAME_HERE",
  licenseKey: "LICENSE_KEY_HERE",
});
```

2. Use `mteFetch()` to send encrypted data

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

MTE uses a Web Assembly (WASM) module to encode and decode data. You must initialize the MTE Relay Client exactly once, and we recommend doing it as early as possible in your application.

```js
import { initMteRelayClient } from "mte-relay-browser";

// Initialize MTE WASM module with credentials
await initMteRelayClient({
  licenseCompany: "COMPANY_NAME_HERE",
  licenseKey: "LICENSE_KEY_HERE",
  numberOfPairs: 5,         // optional, default 5
  mtePoolSize: 2,           // optional, default 2
  mkePoolSize: 5,           // optional, default 5
  encodeType: "MKE",        // optional, default MKE
  encodeUrls: true,         // optional, default true
  encodeHeaders: true,      // optional, default true
});
```

### Options

- `licenseCompany`
  - **Required**
  - Type: string
  - The company name associated with your MTE license
- `licenseKey`
  - **Required**
  - Type: string
  - The license key associated with your MTE license
- `numberOfPairs`
  - Type: number
  - Default: `5`
  - The number of encoder/decoder pairs to create when pairing with an MTE Relay server.
- `mtePoolSize`
  - Type: number
  - Default: `2`
  - How many MTE encoder/decoder objects to hold in memory to be ready for use. 
- `mkePoolSize`
  - Type: number
  - Default: `5`
  - How many MKE encoder/decoder objects to hold in memory to be ready for use.
- `encodeType`
  - Type: `MTE` | `MKE`
  - Default: `MKE`
  - The default encode type to use on all requests.
- `encodeUrls`
  - Type: boolean
  - Default: `true`
  - When true, URLs will be encoded by default on all requests. When false, URLs are not encoded.
- `encodeHeaders`
  - Type: boolean | string[]
  - Default `true`
  - When true, custom headers in the `fetch` headers object will be encoded. When provided with an array of strings, only the headers whose keys are found in the array will be encoded. When false, headers are not encoded.

## Using mteFetch()

MTE Relay Browser exports a function called `mteFetch` that accepts the same arguments as the native [fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch) in modern browsers. However, unlike a normal fetch, it will first attempt to establish a connection with a server-side MTE Relay, and then MTE encrypt all data sent between the two end points. Encrypting and decrypting data is handled automatically, and mteFetch can be used as a normal fetch.

```js
import { mteFetch } from "mte-relay-browser";

// use mteFetch to handle encoding data and sending/receiving it
const response = await mteFetch(
  "https://mte-relay-server.example.com/api/login",
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

> Note: This library is designed to only communicate with a properly configured [MTE Relay Server](https://www.npmjs.com/package/mte-relay-server).

### MTE Options

mteFetch() accepts three arguments:\
`mteFetch(url, [options,] [mteOptions])`

The third argument, `mteOptions`, is an optional object that can be used to configure mteFetch functionality for that specific request. Each property set here is optional, and overrides the default options set in `initMteRelayClient`.


- `encodeType`
  - Type: `MTE` | `MKE`
- `encodeUrl`
  - Type: boolean
- `encodeHeaders`
  - Type: boolean | string[]

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
  encodeType: 'MTE'
  encodeHeaders: true,
  encodeUrl: true
});
```

## Q and A

#### What is MTE and what is MKE? 

MicroToken Exchange (MTE) is a next-generation, patented, quantum-resistant encoding technology that replaces your data with random streams of values. For every byte of real data, multiple bytes of random data is generated to replace it. For this reason, MTE is the most secure way to encode and transmit data, but it also results in much larger packet sizes. Since replacement tokens are randomly generated, even if you're sending the same data, the encoded values are different every time.

Managed Key Encryption (MKE) is a method using MTE to generate random, single-use encryption keys. You data can then be encrypted using industry-leading encryption algorithms. Encryption keys can be generated on both sides, and do not need to be sent over the network or managed by a human. Encryption keys are uniquely generated for each new encryption, so that even if you're sending the same data twice, the encrypted values are different every time.

#### When should I use MTE or MKE to encode data?

MTE is the most secure way to encode data, although it does create much larger payloads. Use MTE when you're encoding small, but highly sensitive data, such as passwords, payment details, or protected personal information.

MKE is ideal for most general network communications, and is capable of sending large payloads or files as streams of encrypted data.

#### What are encoder/decoder pairs, and when should I configure Relay to create more of them?

Encoders and decoders have a one-to-one relationship. One encoder is paired to exactly one decoder. To facilitate round-trip requests between a client and server, we must create two one-way encoder/decoder relations. One to send a request from the client to the server, and a second to send a response from the server to the client. This is called an encoder/decoder pair. Encoders and decoders are synchronous, and while they are in use they can't be used by someone else. IF an encoder is in use and called by someone else, it may result in an encode or decode error.

To facilitate high-traffic applications, we create multiple encoder/decoder pairs, and spread all network requests evenly between then in a round-robin format. The default number of encoder/decoder pairs to create is 5, which should be acceptable for most web applications. However, if you have a high-traffic application you may want to increase this to a larger number. There is no upper limit, although I recommend slowly increasing the number and monitoring your application for errors. If you're still experiencing errors, simply raise the number of encoder/decoder pairs using the `numberOfPairs` option in the `initMteRelayClient` function.

#### What should I change mtePoolSize and mkePoolSize?

The MTE and MKE pools are in-memory pools that hold ready-to-use encoder and decoder objects. Generally speaking, this number should match the number of encoder/decoder pairs you're creating. The MTE pool is a special case that is typically lower, since MTE encode/decodes are used less frequently.
