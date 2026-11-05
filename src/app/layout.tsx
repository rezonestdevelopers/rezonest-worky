import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "@/components/providers";
import { PwaRegister } from "@/components/layout/pwa-register";
import { getSettings, safeHex } from "@/lib/settings";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Rezonest Work OS", template: "%s · Rezonest Work OS" },
  description: "Agency management system for Rezonest Digital & Services",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Work OS", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f9fb" },
    { media: "(prefers-color-scheme: dark)", color: "#16171c" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let accent = "#d7202a";
  try {
    accent = safeHex((await getSettings())?.accentColor);
  } catch {
    // DB unavailable (e.g. during build) — fall back to the default brand colour
  }
  return (
    <html
      lang="en-IN"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      style={{ "--brand": accent } as React.CSSProperties}
    >
      <body>
        <Providers>{children}</Providers>
        <PwaRegister />
      </body>
    </html>
  );
}
