import type { Metadata, Viewport } from "next";
import { Archivo_Black, Inter } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import { BottomNav } from "@/components/BottomNav";
import "./globals.css";

const display = Archivo_Black({ weight: "400", subsets: ["latin"], variable: "--font-archivo-black", display: "swap" });
const sans = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Rayne Fit",
  description: "Did I do what I said I would do? Daily YES/NO accountability with grades, reminders and nudges.",
  manifest: "/manifest.webmanifest",
  applicationName: "Rayne Fit",
  appleWebApp: { capable: true, title: "Rayne Fit", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#1A1A1A",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body className="min-h-dvh">
        <AppShell>
          <main className="mx-auto max-w-xl px-4 pb-28" style={{ paddingTop: "max(env(safe-area-inset-top), 1rem)" }}>
            {children}
          </main>
          <BottomNav />
        </AppShell>
      </body>
    </html>
  );
}
