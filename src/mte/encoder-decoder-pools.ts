import { MteEnc, MteDec, MteMkeEnc, MteMkeDec, MteWasm } from "mte";

type EncDecTypes = "MTE" | "MKE";

/**
 * Arrays of blank encoders and decoders.
 */
const mteEncoderPool: MteEnc[] = [];
const mteDecoderPool: MteDec[] = [];
const mkeEncoderPool: MteMkeEnc[] = [];
const mkeDecoderPool: MteMkeDec[] = [];

/**
 * Default max pool size.
 */
let mtePoolSize = 3;
let mkePoolSize = 6;

/**
 * Fill pools with correct amount of default
 */
export function fillEncDecPools(options: {
  mteWasm: MteWasm;
  mtePoolSize?: number;
  mkePoolSize?: number;
}) {
  mtePoolSize = options.mtePoolSize || mtePoolSize;
  mkePoolSize = options.mkePoolSize || mkePoolSize;
  let i = 0;
  while (i < mtePoolSize) {
    ++i;
    mteEncoderPool.push(MteEnc.fromdefault(options.mteWasm));
    mteDecoderPool.push(MteDec.fromdefault(options.mteWasm));
  }
  i = 0;
  while (i < mkePoolSize) {
    ++i;
    mkeEncoderPool.push(MteMkeEnc.fromdefault(options.mteWasm));
    mkeDecoderPool.push(MteMkeDec.fromdefault(options.mteWasm, 1000, -63));
  }
}

// get encoder from pool, or create a new default encoder if pool is empty
export function getEncoderFromPool(type: EncDecTypes, mteWasm: MteWasm) {
  if (type === "MTE") {
    const encoder = mteEncoderPool.pop();
    return encoder || MteEnc.fromdefault(mteWasm);
  }
  const encoder = mkeEncoderPool.pop();
  return encoder || MteMkeEnc.fromdefault(mteWasm);
}

// get decoder from pool, or create a new default decoder if pool is empty
export function getDecoderFromPool(type: EncDecTypes, mteWasm: MteWasm) {
  if (type === "MTE") {
    const decoder = mteDecoderPool.pop();
    return decoder || MteDec.fromdefault(mteWasm);
  }
  const decoder = mkeDecoderPool.pop();
  return decoder || MteMkeDec.fromdefault(mteWasm, 1000, -63);
}

// return encoder to pool, or destruct if pool is full
export function returnEncoderToPool(encoder: MteMkeEnc | MteEnc) {
  if (encoder instanceof MteEnc) {
    if (mteEncoderPool.length < mtePoolSize) {
      encoder.uninstantiate();
      return mteEncoderPool.push(encoder);
    }
    return encoder.destruct();
  }
  if (mkeEncoderPool.length < mkePoolSize) {
    encoder.uninstantiate();
    return mkeEncoderPool.push(encoder);
  }
  return encoder.destruct();
}

// return decoder to pool, or destruct if pool is full
export function returnDecoderToPool(decoder: MteMkeDec | MteDec) {
  if (decoder instanceof MteDec) {
    if (mteDecoderPool.length < mtePoolSize) {
      decoder.uninstantiate();
      return mteDecoderPool.push(decoder);
    }
    return decoder.destruct();
  }
  if (mkeDecoderPool.length < mkePoolSize) {
    decoder.uninstantiate();
    return mkeDecoderPool.push(decoder);
  }
  return decoder.destruct();
}
