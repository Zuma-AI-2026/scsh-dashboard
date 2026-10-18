import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Internal, auth-gated, always-fresh dashboard: every page is dynamic.
  // Cache Components / partial prefetching add Suspense-boundary constraints
  // around session reads with no benefit here, so they're disabled.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
