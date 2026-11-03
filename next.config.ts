import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The PDF library and its fonts are loaded from disk when the server runs.
  serverExternalPackages: ["@react-pdf/renderer"],
  outputFileTracingIncludes: { "/**": ["./src/lib/pdf/fonts/*"] },
  experimental: {
    // Default is 1 MB. Logos go up to 2 MB and Excel imports up to 5 MB.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
