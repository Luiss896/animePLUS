import http from "node:http";

/**
 * Make Windows offer to allow inbound traffic for this app.
 *
 * Peer-to-peer WebRTC needs *inbound* UDP: the remote peer sends connectivity
 * checks to ports this app opened, and Windows Firewall drops them silently when
 * the application has no inbound rule. The failure is indistinguishable from a
 * restrictive NAT — ICE simply reports `failed` after about thirty seconds.
 *
 * The firewall only offers its prompt for a process that is actually listening,
 * and the prompt is what creates the rule. An outbound UDP socket, which is all
 * WebRTC opens on its own, never triggers it. So the internet mode opens the same
 * kind of listener the LAN mode does — which is why LAN parties produce the prompt
 * and internet parties did not, and why one machine could work while the other
 * silently dropped every packet.
 *
 * The resulting rule is application-scoped and covers every port and protocol, so
 * a single accepted prompt fixes the internet mode for good. Binding `0.0.0.0` is
 * deliberate for the same reason the LAN host does it: the prompt is about the
 * application, not the address.
 */
let server: http.Server | null = null;

export async function startInboundWarmup(): Promise<number | null> {
  if (server) {
    const existing = server.address();
    return typeof existing === "object" && existing ? existing.port : null;
  }

  const srv = http.createServer((_req, res) => {
    // Nothing is served here; the listener exists to be visible to the firewall.
    res.writeHead(204).end();
  });

  const port = await new Promise<number | null>((resolve) => {
    srv.once("error", () => resolve(null));
    srv.listen(0, "0.0.0.0", () => {
      srv.removeAllListeners("error");
      const addr = srv.address();
      resolve(typeof addr === "object" && addr ? addr.port : null);
    });
  });

  if (port === null) {
    try {
      srv.close();
    } catch {
      /* never opened */
    }
    return null;
  }
  server = srv;
  return port;
}

export function stopInboundWarmup(): void {
  const active = server;
  server = null;
  if (!active) return;
  try {
    active.close();
    active.closeAllConnections?.();
  } catch {
    /* already gone */
  }
}
