import { readStore } from "./store";

/** Server-side app name lookup without auth (for layout metadata). */
export async function getAppNameServer(): Promise<string> {
  const store = await readStore();
  return store.settings.general.appName || "DocFlow";
}
