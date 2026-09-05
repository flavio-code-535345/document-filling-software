// File-based persistence: one JSON store ($DATA_DIR/store.json) + template PDFs.
// Single process, serialized writes via an in-process mutex chain.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Settings, Store } from "./types";

const DEFAULT_SETTINGS: Settings = {
  general: { appName: "DocFlow", appIcon: "📄" },
  smtp: { host: "", port: 587, secure: false, user: "", pass: "", from: "" },
  pdf: { defaultFontSize: 11, emailEnabled: false, emailTo: "" },
};

const EMPTY_STORE: Store = {
  users: [],
  templates: [],
  settings: DEFAULT_SETTINGS,
  requests: [],
};

export function dataDir(): string {
  return path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
}

export function templatesDir(): string {
  return path.join(dataDir(), "templates");
}

export function storePath(): string {
  return path.join(dataDir(), "store.json");
}

let writeChain: Promise<void> = Promise.resolve();

/** Serializes all store mutations to prevent concurrent read-modify-write races. */
export async function withStore<T>(fn: (store: Store) => T | Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const store = await readStore();
    const result = await fn(store);
    await writeStore(store);
    return result;
  };
  const next = writeChain.then(run, run);
  writeChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

export async function readStore(): Promise<Store> {
  try {
    const raw = await fsp.readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw) as Store;
    return {
      ...EMPTY_STORE,
      ...parsed,
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
    };
  } catch {
    return structuredClone(EMPTY_STORE);
  }
}

async function writeStore(store: Store): Promise<void> {
  await fsp.mkdir(dataDir(), { recursive: true });
  await fsp.writeFile(storePath(), JSON.stringify(store, null, 2), "utf8");
}

export async function ensureDirs(): Promise<void> {
  await fsp.mkdir(templatesDir(), { recursive: true });
}

export function templatePdfPath(fileName: string): string {
  return path.join(templatesDir(), fileName);
}

export function isStoreFilePresent(): boolean {
  return fs.existsSync(storePath());
}
