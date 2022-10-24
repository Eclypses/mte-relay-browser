import path from "path";
import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";

/** @type {import('vite').UserConfig} */
export default {
  build: {
    manifest: true,
    minify: false,
    reportCompressedSize: true,
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      fileName: "index",
      formats: ["es", "cjs"],
      name: "mte-browser-translator",
    },
    rollupOptions: {
      external: [/^mte?/], // the "mte" library is a peer dependency, but the "mte-helpers" library can be a full dependency of this package
      plugins: [
        typescript({
          sourceMap: false,
          declaration: true,
          outDir: "dist",
        }),
        nodeResolve(),
      ],
    },
  },
};
