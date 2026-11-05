import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The PDF library and its fonts are loaded from disk when the server runs.
  serverExternalPackages: ["@react-pdf/renderer"],
  outputFileTracingIncludes: { "/**": ["./src/lib/pdf/fonts/*"] },
  async headers() {
    const everywhere = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      // Browsers ignore this over plain http, so it only takes effect on the live https address.
      { key: "Strict-Transport-Security", value: "max-age=31536000" },
    ];
    return [
      { source: "/:path*", headers: everywhere },
      // Pages only: PDFs and downloads set their own rules.
      { source: "/((?!api/).*)", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" }] },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
  experimental: {
    // Default is 1 MB. Client documents and bills go up to 20 MB.
    serverActions: { bodySizeLimit: "21mb" },
  },
};

export default nextConfig;
