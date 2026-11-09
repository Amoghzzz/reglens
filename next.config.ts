import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The search index and generated results are read from disk at runtime, so include them in the server bundle.
  outputFileTracingIncludes: {
    "/*": ["./data/chunks.json", "./data/vectors.bin", "./data/eval/**/*", "./data/runtime/**/*.json", "./data/sync/verified.json"],
    "/api/**/*": ["./data/chunks.json", "./data/vectors.bin", "./data/eval/**/*", "./data/runtime/**/*.json", "./data/sync/verified.json"],
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
      },
    },
  },
};

export default nextConfig;
