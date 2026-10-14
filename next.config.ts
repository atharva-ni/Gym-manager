import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  compress: true,
  poweredByHeader: false,
  experimental: {
    // Expense bill photos are uploaded through a server action
    serverActions: { bodySizeLimit: "6mb" },
    optimizePackageImports: ["lucide-react", "recharts"],
  },
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
