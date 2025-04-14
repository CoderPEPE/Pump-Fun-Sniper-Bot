import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import replace from "@rollup/plugin-replace";

export default {
  input: "src/browser.ts",
  plugins: [
    replace({
      preventAssignment: true,
      'process.env.NODE_ENV': JSON.stringify('production')
    }),
    commonjs(),
    json(),
    nodeResolve({
      browser: true,
      extensions: [".js", ".ts"],
      preferBuiltins: false,
    }),
    typescript({
      tsconfig: "./tsconfig.base.json",
      moduleResolution: "node",
      outDir: "types",
      target: "es2022",
      outputToFilesystem: false,
    }),
  ],
  external: [
    "@coral-xyz/borsh",
    "@solana/web3.js",
    "@solana/spl-token",
    "@coral-xyz/anchor",
    "dv-sol-lib",
    "jito-ts",
    "@quicknode/sdk",
    "path",
    "fs",
    "crypto",
    "os",
    "stream",
    "assert",
    "util",
    "zlib",
    "net",
    "dns",
    "http2",
    "tls",
    "http",
    "url",
    "readline"
  ],
  output: {
    file: "dist/browser/index.js",
    format: "es",
    sourcemap: true,
    globals: {
      "path": "{}",
      "fs": "{}",
      "crypto": "{}",
      "os": "{}",
      "stream": "{}",
      "assert": "{}",
      "util": "{}",
      "zlib": "{}",
      "net": "{}",
      "dns": "{}",
      "http2": "{}",
      "tls": "{}",
      "http": "{}",
      "url": "{}",
      "readline": "{}"
    }
  },
  onwarn: function(warning, warn) {
    // Skip certain warnings
    if (warning.code === 'CIRCULAR_DEPENDENCY' || 
        warning.code === 'EVAL' ||
        warning.message.includes('this has been rewritten to undefined')) {
      return;
    }
    
    warn(warning);
  }
};