# Migrating from v3 to v4

1. Install MTE Relay Browser v4

   - `npm i mte-relay-browser@4`

2. Change `instantiateMteWasm` to `initMteRelayClient`

   - Should only be found in one place in your source code.
   - The new name is less ambiguous and more closely related the name of the package.

3. Update your license key.

   - Find the new v4 license in the [Developer Portal](https://developers.eclypses.com)
   - Update the old license key with the new one

4. Change `numberEncoderDecoderPairs` to `numberOfPairs`

   - Same property, just a new shorter name.

5. Deprecated `encoderDecoderPoolSize` in favor of two new properties:

   - `mtePoolSize` - Pool size for MTE encoder/decoders. Default is 2 if omitted.
   - `mkePoolSize` - Pool size for MKE encoder/decoders. Default is 5 if omitted.

6. Change `defaultEncodeType` to `encodeType`.

   - Same property, just a new shorter name.

Done! Enjoy v4!
