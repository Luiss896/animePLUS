import { Check, Copy, LogOut, PartyPopper, Users, Wifi } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";

import { Badge } from "@/renderer/components/ui/badge";
import { Button } from "@/renderer/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/renderer/components/ui/card";
import { Input } from "@/renderer/components/ui/input";
import { SectionHeading } from "@/renderer/components/section-heading";
import { useWatchParty } from "@/renderer/features/watch-party/party-provider";
import { cn } from "@/renderer/lib/utils";

/**
 * Watch party page.
 *
 * Setup only: creating or joining a room, and presence. The player itself is
 * driven from the watch page, which is where a `<video>` exists — this page never
 * needs to know about playback.
 */

/** Human label for the transport state. Kept in one place so both roles agree. */
function statusLabel(state: string): { text: string; tone: "muted" | "ok" | "warn" | "bad" } {
  switch (state) {
    case "listening":
      return { text: "In attesa di un ospite", tone: "warn" };
    case "connecting":
      return { text: "Connessione…", tone: "warn" };
    case "connected":
      return { text: "Connesso", tone: "ok" };
    case "closed":
      return { text: "Disconnesso", tone: "bad" };
    case "error":
      return { text: "Errore", tone: "bad" };
    default:
      return { text: "Non attivo", tone: "muted" };
  }
}

const TONE_CLASS: Record<"muted" | "ok" | "warn" | "bad", string> = {
  muted: "bg-muted text-muted-foreground",
  ok: "bg-emerald-500 text-white",
  warn: "bg-amber-500 text-white",
  bad: "bg-destructive text-white",
};

export function PartyPage() {
  const { session, actions, displayName, setDisplayName } = useWatchParty();
  const [address, setAddress] = useState("");
  const [pin, setPin] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(displayName);

  useEffect(() => {
    setNameDraft(displayName);
  }, [displayName]);

  const copy = useCallback(async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
    } catch {
      // Clipboard can be unavailable; the value is on screen and selectable anyway.
    }
  }, []);

  const status = statusLabel(session.status);
  const isHost = session.role === "host";
  const isGuest = session.role === "guest";
  const active = session.role !== null;
  /*
   * Bound to a const so the narrowing survives into the click handlers below:
   * `session.hostInfo` would be re-read inside the closure, where TypeScript can no
   * longer prove it is non-null.
   */
  const hostInfo = isHost ? session.hostInfo : null;

  return (
    <div className="oa-page-enter mx-auto flex w-full max-w-[900px] flex-col gap-6 p-6 md:p-8">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft/60">
          <PartyPopper className="h-5 w-5 text-accent-glow" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Watch party</h1>
          <p className="text-sm text-muted-foreground">
            Guarda un episodio in sincronia con un&apos;altra persona che ha animePLUS.
          </p>
        </div>
        <Badge className={cn("ml-auto", TONE_CLASS[status.tone])} data-party-status={session.status}>
          {status.text}
        </Badge>
      </div>

      {session.error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {session.error}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <SectionHeading title="Il tuo nome" />
        <div className="flex gap-2">
          <Input
            value={nameDraft}
            maxLength={32}
            placeholder="Come ti vedrà l'altra persona"
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => setDisplayName(nameDraft)}
            className="max-w-xs"
          />
          <Button variant="secondary" onClick={() => setDisplayName(nameDraft)}>
            Salva
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Viene mostrato all&apos;altra persona nella stanza. Non usiamo il nome del tuo account.
        </p>
      </section>

      {!active ? (
        <section className="flex flex-col gap-3">
          <SectionHeading title="Inizia" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4" /> Crea una stanza
                </CardTitle>
                <CardDescription>
                  Ti diamo un indirizzo e un PIN da mandare all&apos;altra persona.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button data-party-action="create" onClick={() => void actions.startHost()}>
                  Crea stanza
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wifi className="h-4 w-4" /> Unisciti
                </CardTitle>
                <CardDescription>
                  Inserisci l&apos;indirizzo e il PIN che ti ha dato chi ospita.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Input
                  data-party-input="address"
                  placeholder="192.168.0.10:54321"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
                <Input
                  data-party-input="pin"
                  placeholder="PIN a 6 cifre"
                  value={pin}
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                />
                <Button
                  data-party-action="join"
                  disabled={!address.trim() || pin.length !== 6 || session.status === "connecting"}
                  onClick={() => void actions.join(address, pin)}
                >
                  Unisciti
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>
      ) : null}

      {hostInfo ? (
        <section className="flex flex-col gap-3">
          <SectionHeading title="Condividi con l'altra persona" />
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Indirizzo
                </span>
                {hostInfo.addresses.length > 0 ? (
                  hostInfo.addresses.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => void copy(value, value)}
                      data-party-address={value}
                      className="flex w-fit items-center gap-2 rounded-md bg-muted px-2 py-1 font-mono text-sm hover:bg-accent"
                    >
                      {value}
                      {copied === value ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </button>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nessun indirizzo di rete trovato: siete collegati alla stessa rete?
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  PIN
                </span>
                <button
                  type="button"
                  onClick={() => void copy("pin", hostInfo.pin)}
                  data-party-pin={hostInfo.pin}
                  className="flex w-fit items-center gap-2 rounded-md bg-muted px-2 py-1 font-mono text-lg tracking-[0.3em] hover:bg-accent"
                >
                  {hostInfo.pin}
                  {copied === "pin" ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Copy className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Funziona fra computer sulla stessa rete. Nessun dato esce dalla rete locale.
              </p>
            </CardContent>
          </Card>
        </section>
      ) : null}

      {active ? (
        <section className="flex flex-col gap-3">
          <SectionHeading title="Partecipanti" />
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="font-medium">{displayName}</span>
              <span className="text-muted-foreground">({isHost ? "host" : "ospite"})</span>
            </div>
            <div
              data-party-peer={session.peerName ?? ""}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  session.peerName ? "bg-emerald-500" : "bg-muted-foreground"
                )}
              />
              {session.peerName ? (
                <>
                  <span className="font-medium">{session.peerName}</span>
                  <span className="text-muted-foreground">({isHost ? "ospite" : "host"})</span>
                </>
              ) : (
                <span className="text-muted-foreground">
                  {isHost ? "Nessun ospite connesso" : "In attesa dell'host"}
                </span>
              )}
            </div>
            {isHost && session.latencyMs != null ? (
              <p className="text-xs text-muted-foreground" data-party-latency={session.latencyMs}>
                Latenza: {session.latencyMs} ms
              </p>
            ) : null}
            {isGuest && session.lastHeartbeatAt ? (
              <p className="text-xs text-muted-foreground">In contatto con l&apos;host.</p>
            ) : null}
          </div>

          <Button
            variant="secondary"
            className="w-fit"
            data-party-action="leave"
            onClick={() => void actions.leave()}
          >
            <LogOut className="mr-2 h-4 w-4" /> Esci dalla stanza
          </Button>
        </section>
      ) : null}
    </div>
  );
}
