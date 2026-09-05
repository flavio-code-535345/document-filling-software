import "./globals.css";
import type { Metadata } from "next";
import AppShell from "@/components/AppShell";
import { getAppNameServer } from "@/lib/settings-server";

export const metadata: Metadata = {
  title: "DocFlow",
  description: "Selbstgehostete PDF-Formular-Maschine",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const appName = await getAppNameServer().catch(() => "DocFlow");
  return (
    <html lang="de">
      <body className="bg-canvas text-ink antialiased">
        <AppShell appName={appName}>{children}</AppShell>
      </body>
    </html>
  );
}
