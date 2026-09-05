"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ProfileDropdown from "./ProfileDropdown";

export interface MeInfo {
  username: string;
  isAdmin: boolean;
  pendingRequests: number;
  hasDefaultSignature?: boolean;
}

export default function AppShell({
  appName: initialAppName,
  children,
}: {
  appName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [appName, setAppName] = useState(initialAppName);
  const [me, setMe] = useState<MeInfo | null>(null);
  const isSignPage = pathname?.startsWith("/sign/");

  useEffect(() => {
    let cancelled = false;
    if (isSignPage) return;
    (async () => {
      const res = await fetch("/api/me", { cache: "no-store" });
      if (!cancelled && res.ok) {
        const data = await res.json();
        setMe({
          username: data.user.username,
          isAdmin: data.user.isAdmin,
          pendingRequests: data.pendingRequests ?? 0,
          hasDefaultSignature: data.user.hasDefaultSignature,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSignPage]);

  useEffect(() => {
    document.title = appName;
  }, [appName]);

  useEffect(() => {
    const onSettingsChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ appName?: string; appIcon?: string }>).detail;
      if (detail?.appName) setAppName(detail.appName);
    };
    window.addEventListener("vw:app-settings-changed", onSettingsChanged);
    return () => window.removeEventListener("vw:app-settings-changed", onSettingsChanged);
  }, []);

  // The public phone-signature page runs without the app chrome.
  if (isSignPage) {
    return <div className="min-h-screen">{children}</div>;
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-strong text-xl">
              📄
            </span>
            <span className="text-lg font-semibold">{appName}</span>
          </Link>
          <div className="ml-auto">
            <ProfileDropdown me={me} appName={appName} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
