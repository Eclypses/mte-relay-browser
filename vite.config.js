import path from "path";
import typescript from "@rollup/plugin-typescript";

/** @type {import('vite').UserConfig} */
export default {
  build: {
    manifest: false,
    minify: true,
    reportCompressedSize: true,
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      fileName: "index",
      formats: ["es", "cjs"],
      name: "mte-relay-browser",
    },
    rollupOptions: {
      external: [/^mte?/], // the "mte" library is a peer dependency
      plugins: [
        typescript({
          sourceMap: false,
          declaration: true,
          outDir: "dist/types",
        }),
      ],
    },
  },
};
