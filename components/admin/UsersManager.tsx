"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface UserItem {
  id: string;
  username: string;
  isAdmin: boolean;
  email: string;
  createdAt: string;
  isSelf: boolean;
}

interface RequestItem {
  id: string;
  username: string;
  createdAt: string;
}

export default function UsersManager({ showsRequests }: { showsRequests: boolean }) {
  const router = useRouter();
  const [users, setUsers] = useState<UserItem[] | null>(null);
  const [requests, setRequests] = useState<RequestItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ username: "", password: "", isAdmin: false });

  const reload = useCallback(async () => {
    const res = await fetch("/api/users", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    setUsers(data.users);
    setRequests(data.requests);
  }, []);

  useEffect(() => {
    (async () => {
      await reload();
    })();
  }, [reload]);

  const handle = async (fn: () => Promise<Response>) => {
    setError(null);
    setMessage(null);
    const res = await fn();
    const data = await res.json().catch(() => null);
    if (!res.ok) return setError(data?.error || "Aktion fehlgeschlagen.");
    setMessage("Gespeichert.");
    await reload();
    router.refresh();
  };

  const createUser = () =>
    handle(() =>
      fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      }).then((res) => {
        if (res.ok) setForm({ username: "", password: "", isAdmin: false });
        return res;
      })
    );

  const setAdmin = (id: string, isAdmin: boolean) =>
    handle(() =>
      fetch(`/api/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAdmin }),
      })
    );

  const removeUser = (id: string, username: string) => {
    if (!window.confirm(`Benutzer „${username}" wirklich löschen?`)) return;
    void handle(() => fetch(`/api/users/${id}`, { method: "DELETE" }));
  };

  const decideRequest = (id: string, action: "approve" | "reject") =>
    handle(() =>
      fetch(`/api/requests/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
    );

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <h1 className="text-2xl font-semibold">Benutzerverwaltung</h1>

      {showsRequests && requests && requests.length > 0 && (
        <section className="rounded-xl border border-accent bg-surface p-5">
          <h2 className="mb-3 font-medium">
            Zugangsanfragen ({requests.length})
          </h2>
          <ul className="space-y-2">
            {requests.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-lg border border-line bg-canvas px-3 py-2"
              >
                <span>
                  <strong>{r.username}</strong>
                  <span className="ml-2 text-xs text-ink-dim">
                    seit {new Date(r.createdAt).toLocaleDateString("de-DE")}
                  </span>
                </span>
                <div className="flex gap-2">
                  <button
                    className="rounded-lg bg-accent-strong px-3 py-1 text-sm text-white"
                    onClick={() => decideRequest(r.id, "approve")}
                  >
                    Freischalten
                  </button>
                  <button
                    className="rounded-lg border border-line px-3 py-1 text-sm text-red-400"
                    onClick={() => decideRequest(r.id, "reject")}
                  >
                    Ablehnen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="mb-3 font-medium">Neuen Benutzer anlegen</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Benutzername
            <input
              className="mt-1 block w-44 rounded-lg border border-line bg-canvas px-3 py-2"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </label>
          <label className="text-sm">
            Passwort
            <input
              type="password"
              className="mt-1 block w-44 rounded-lg border border-line bg-canvas px-3 py-2"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={form.isAdmin}
              onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })}
            />
            Administrator
          </label>
          <button
            className="rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-white"
            onClick={createUser}
          >
            Anlegen
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="mb-3 font-medium">Benutzer</h2>
        {users === null ? (
          <p className="text-sm text-ink-dim">Lädt…</p>
        ) : (
          <ul className="space-y-2">
            {users.map((u) => (
              <li
                key={u.id}
                className="flex items-center justify-between rounded-lg border border-line bg-canvas px-3 py-2"
              >
                <span>
                  <strong>{u.username}</strong>
                  {u.isSelf && (
                    <span className="ml-2 text-xs text-ink-dim">(du)</span>
                  )}
                  {u.isAdmin && (
                    <span className="ml-2 rounded bg-accent/20 px-1.5 py-0.5 text-xs text-accent">
                      Admin
                    </span>
                  )}
                  {u.email && (
                    <span className="ml-2 text-xs text-ink-dim">{u.email}</span>
                  )}
                </span>
                <div className="flex gap-2">
                  {!u.isSelf && (
                    <button
                      className="rounded-lg border border-line px-3 py-1 text-xs hover:border-accent"
                      onClick={() => setAdmin(u.id, !u.isAdmin)}
                    >
                      {u.isAdmin ? "Zum Benutzer machen" : "Zum Admin machen"}
                    </button>
                  )}
                  {!u.isSelf && (
                    <button
                      className="rounded-lg border border-line px-3 py-1 text-xs text-red-400 hover:border-red-400"
                      onClick={() => removeUser(u.id, u.username)}
                    >
                      Löschen
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {message && <p className="text-sm text-green-400">{message}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
