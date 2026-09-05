"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MeInfo } from "./AppShell";

export default function ProfileDropdown({
  me,
  appName,
}: {
  me: MeInfo | null;
  appName: string;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  const openMenu = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const closeMenuSoon = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  if (!me) {
    return (
      <Link
        href="/login"
        className="rounded-lg border border-line bg-surface-2 px-4 py-2 text-sm hover:border-accent"
      >
        Anmelden
      </Link>
    );
  }

  return (
    <div className="relative" onMouseEnter={openMenu} onMouseLeave={closeMenuSoon}>
      <button
        className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-accent-strong text-xs font-bold uppercase">
          {me.username.slice(0, 1)}
        </span>
        <span>{me.username}</span>
        <span className="text-xs">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-60 rounded-lg border border-line bg-surface shadow-xl">
          <Link
            href="/"
            className="block px-4 py-2 text-sm hover:bg-surface-2"
            onClick={() => setOpen(false)}
          >
            Formulare
          </Link>
          <Link
            href="/profile"
            className="block px-4 py-2 text-sm hover:bg-surface-2"
            onClick={() => setOpen(false)}
          >
            Mein Profil
          </Link>
          {me.isAdmin && (
            <>
              <div className="my-1 border-t border-line" />
              <Link
                href="/admin"
                className="block px-4 py-2 text-sm hover:bg-surface-2"
                onClick={() => setOpen(false)}
              >
                Vorlagen
              </Link>
              <Link
                href="/admin/settings"
                className="block px-4 py-2 text-sm hover:bg-surface-2"
                onClick={() => setOpen(false)}
              >
                Einstellungen
              </Link>
              <Link
                href="/admin/users"
                className="flex items-center justify-between px-4 py-2 text-sm hover:bg-surface-2"
                onClick={() => setOpen(false)}
              >
                <span>Benutzerverwaltung</span>
                {me.pendingRequests > 0 && (
                  <span className="rounded-full bg-accent-strong px-2 py-0.5 text-xs font-bold">
                    {me.pendingRequests}
                  </span>
                )}
              </Link>
            </>
          )}
          <div className="my-1 border-t border-line" />
          <button
            className="block w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-surface-2"
            onClick={logout}
          >
            Abmelden
          </button>
        </div>
      )}
    </div>
  );
}
