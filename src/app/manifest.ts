import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Rezonest Work OS",
    short_name: "Work OS",
    description: "Run Rezonest Digital & Services: clients, offers, work, invoices and payments.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f8f9fb",
    theme_color: "#d7202a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "My tasks", url: "/tasks?mine=1" },
      { name: "Dashboard", url: "/dashboard" },
    ],
  };
}
