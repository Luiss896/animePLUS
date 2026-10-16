import os from "node:os";

export interface LanAddress {
  address: string;
  iface: string;
  /** RFC1918 (or CGNAT) — reachable from another machine without routing tricks. */
  isPrivate: boolean;
}

/**
 * Rank for a dialable address, lowest first.
 *
 * A plain home LAN address is what a friend in the same house needs, so it must be
 * offered first. Overlay/VPN addresses (Tailscale's 100.64/10 and friends) are
 * genuinely useful but only work if the peer is on the same overlay, so they are
 * listed after, not instead.
 */
function addressRank(address: string): number {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return 3;
  }
  const [a, b] = parts;
  if (a === 192 && b === 168) return 0;
  if (a === 10) return 1;
  if (a === 172 && b >= 16 && b <= 31) return 1;
  // CGNAT, which is where Tailscale and similar overlays live.
  if (a === 100 && b >= 64 && b <= 127) return 2;
  return 3;
}

function isPrivateIPv4(address: string): boolean {
  return addressRank(address) <= 2;
}

/**
 * IPv4 addresses another machine on the same network could dial.
 *
 * Loopback is excluded (nobody can reach it) and so is link-local 169.254/16,
 * which only appears when DHCP failed and never routes anywhere useful. Home LAN
 * addresses come first, then overlay/VPN ones: a friend in the same house should
 * be given the address that works for them without needing Tailscale too.
 */
export function listLanAddresses(): LanAddress[] {
  const out: LanAddress[] = [];
  const interfaces = os.networkInterfaces();
  for (const [iface, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      // Node <18 reports family as "IPv4"; newer versions expose the number 4.
      const isIPv4 = entry.family === "IPv4" || (entry.family as unknown as number) === 4;
      if (!isIPv4 || entry.internal) continue;
      if (entry.address.startsWith("169.254.")) continue;
      out.push({
        address: entry.address,
        iface,
        isPrivate: isPrivateIPv4(entry.address),
      });
    }
  }
  return out.sort((a, b) => addressRank(a.address) - addressRank(b.address));
}

/** Best single address to show the user first, or null when only loopback exists. */
export function pickPrimaryLanAddress(): string | null {
  return listLanAddresses()[0]?.address ?? null;
}
