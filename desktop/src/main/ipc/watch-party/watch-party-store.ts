import { appStore } from "@/main/store";

const DEFAULT_DISPLAY_NAME = "Ospite";

/**
 * Name shown to the other side of a party.
 *
 * Persisted so a user does not retype it every session. Defaults to a generic
 * label rather than the OS user name: that would leak the machine account name to
 * whoever is on the other end of the party.
 */
export function getPartyDisplayName(): string {
  const stored = appStore.get("party.displayName");
  if (typeof stored === "string" && stored.trim()) return stored.trim();
  return DEFAULT_DISPLAY_NAME;
}

export function setPartyDisplayName(name: string): string {
  const cleaned = name.trim().slice(0, 32) || DEFAULT_DISPLAY_NAME;
  appStore.set("party.displayName", cleaned);
  return cleaned;
}
