import { LogOut, PartyPopper, Wifi, WifiOff } from "lucide-react";
import React from "react";

import { Button } from "@/renderer/components/ui/button";
import { cn } from "@/renderer/lib/utils";

import { useWatchParty } from "@/renderer/features/watch-party/party-provider";

/**
 * Slim party strip above the player.
 *
 * Shown only while a session is active, and deliberately quiet: it reports who is
 * on the other end and whether the link is healthy, and gets out of the way. The
 * guest is told plainly that it is not driving, because the player's own controls
 * still work locally and would otherwise look broken when a seek is undone by the
 * next heartbeat.
 */
export function PartyStatusBar({ driftMs }: { driftMs?: number }) {
  const { session, actions } = useWatchParty();

  if (session.role === null) return null;

  const isHost = session.role === "host";
  const connected =
    session.status === "connected" && (isHost ? session.guestConnected : true);

  const driftLabel =
    !isHost && driftMs != null && Number.isFinite(driftMs)
      ? `${driftMs > 0 ? "+" : ""}${Math.round(driftMs)} ms`
      : null;

  return (
    <div
      data-party-bar={session.role}
      className="flex shrink-0 items-center gap-2 border-b border-border bg-background/80 px-3 py-1.5 text-xs backdrop-blur"
    >
      <span className="flex items-center gap-1.5 font-medium text-accent-glow">
        <PartyPopper className="h-3.5 w-3.5" />
        Watch party
      </span>
      <span className="text-muted-foreground">{isHost ? "Host" : "Ospite"}</span>

      <span
        className={cn(
          "flex items-center gap-1",
          connected ? "text-emerald-500" : "text-amber-500"
        )}
      >
        {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
        {connected
          ? session.peerName
            ? `con ${session.peerName}`
            : "connesso"
          : session.status === "connecting"
            ? "connessione…"
            : isHost
              ? "in attesa di un ospite"
              : "in attesa dell'host"}
      </span>

      {isHost && session.latencyMs != null ? (
        <span className="text-muted-foreground" data-party-bar-latency={session.latencyMs}>
          {session.latencyMs} ms
        </span>
      ) : null}

      {driftLabel ? (
        <span className="text-muted-foreground" data-party-bar-drift={Math.round(driftMs ?? 0)}>
          scarto {driftLabel}
        </span>
      ) : null}

      <span className="ml-auto flex items-center gap-2">
        {!isHost ? (
          <span className="text-muted-foreground">Solo l&apos;host controlla la riproduzione</span>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          data-party-bar-leave
          onClick={() => void actions.leave()}
        >
          <LogOut className="mr-1 h-3 w-3" /> Esci
        </Button>
      </span>
    </div>
  );
}
