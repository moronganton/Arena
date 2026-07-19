import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "StayHQ — Property Management System",
  description: "Manage your short-term rental properties across all channels in one place",
  // Installed-app behavior on iOS (standalone window, home-screen icon)
  appleWebApp: { capable: true, title: "StayHQ", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  // Lets content extend under the notch/Dynamic Island and home indicator so
  // env(safe-area-inset-*) resolves to real values instead of 0 — required
  // for the fixed top bar and bottom tab bar to clear them correctly.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
