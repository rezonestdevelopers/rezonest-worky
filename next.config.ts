import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The PDF library and its fonts are loaded from disk when the server runs.
  serverExternalPackages: ["@react-pdf/renderer"],
  outputFileTracingIncludes: { "/**": ["./src/lib/pdf/fonts/*"] },
  experimental: {
    // Default is 1 MB. Client documents and bills go up to 20 MB.
    serverActions: { bodySizeLimit: "21mb" },
  },
};

export default nextConfig;
