import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Default is 1 MB. Logos go up to 2 MB and Excel imports up to 5 MB.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
