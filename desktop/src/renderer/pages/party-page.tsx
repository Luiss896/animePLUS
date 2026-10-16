import { Check, Copy, Globe, Link2, LogOut, PartyPopper, Users, Wifi } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";

import { Badge } from "@/renderer/components/ui/badge";
import { Button } from "@/renderer/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/renderer/components/ui/card";
import { Input } from "@/renderer/components/ui/input";
import { Textarea } from "@/renderer/components/ui/textarea";
import { SectionHeading } from "@/renderer/components/section-heading";
import { useWatchParty } from "@/renderer/features/watch-party/party-provider";
import { cn } from "@/renderer/lib/utils";

/**
 * Watch party page.
 *
 * Setup only: create or join a room, and presence. The player is driven from the
 * watch page, which is where a `<video>` exists — this page never needs to know
 * about playback.
 *
 * Two transports, and the difference the user sees is how the two sides find each
 * other. On the same network the host simply reads out an address and a PIN. Over
 * the internet there is no address to read: the host and guest exchange two codes,
 * which is the cost of not running a signalling server.
 */

type Tone = "muted" | "ok" | "warn" | "bad";

function statusLabel(state: string): { text: string; tone: Tone } {
  switch (state) {
    case "listening":
      return { text: "Waiting for the other person", tone: "warn" };
    case "connecting":
      return { text: "Connecting…", tone: "warn" };
    case "connected":
      return { text: "Connected", tone: "ok" };
    case "closed":
      return { text: "Disconnected", tone: "bad" };
    case "error":
      return { text: "Error", tone: "bad" };
    default:
      return { text: "Not active", tone: "muted" };
  }
}

const TONE_CLASS: Record<Tone, string> = {
  muted: "bg-muted text-muted-foreground",
  ok: "bg-emerald-500 text-white",
  warn: "bg-amber-500 text-white",
  bad: "bg-destructive text-white",
};

/** Copy button with a short confirmation, shared by every code on the page. */
function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable; the code is selectable on screen anyway.
    }
  }, [value]);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => void copy()}
      data-party-copy={label}
    >
      {copied ? (
        <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <Copy className="mr-1.5 h-3.5 w-3.5" />
      )}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export function PartyPage() {
  const { session, actions, displayName, setDisplayName } = useWatchParty();
  const [address, setAddress] = useState("");
  const [pin, setPin] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const [answerInput, setAnswerInput] = useState("");
  const [nameDraft, setNameDraft] = useState(displayName);

  useEffect(() => {
    setNameDraft(displayName);
  }, [displayName]);

  const status = statusLabel(session.status);
  const isHost = session.role === "host";
  const active = session.role !== null;
  const overInternet = session.transportKind === "webrtc";
  const busy = session.status === "connecting";

  return (
    <div className="oa-page-enter mx-auto flex w-full max-w-[900px] flex-col gap-6 p-6 md:p-8">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft/60">
          <PartyPopper className="h-5 w-5 text-accent-glow" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Watch party</h1>
          <p className="text-sm text-muted-foreground">
            Watch an episode in sync with someone else who has animePLUS.
          </p>
        </div>
        <Badge className={cn("ml-auto", TONE_CLASS[status.tone])} data-party-status={session.status}>
          {status.text}
        </Badge>
      </div>

      {session.error ? (
        <div
          data-party-error
          className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <span>{session.error}</span>
          {/*
            Shown because a failed peer connection has two very different causes and
            the counts tell them apart: no `srflx` means no public address was found,
            so nothing outside this network can ever connect; plenty of `srflx` with a
            failure means the networks refuse the direct path.
          */}
          {session.diagnostics ? (
            <span className="font-mono text-xs opacity-80" data-party-diagnostics>
              candidates: {session.diagnostics.hostCandidates} host,{" "}
              {session.diagnostics.srflxCandidates} public, {session.diagnostics.relayCandidates}{" "}
              relay · ICE: {session.diagnostics.iceState} · peer:{" "}
              {session.diagnostics.connectionState}
            </span>
          ) : null}
          <span className="text-xs opacity-80">
            Try again and exchange the two codes quickly — the connection attempt gives up after
            about a minute. If it keeps failing, use same-network mode.
          </span>
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        <SectionHeading title="Your name" />
        <div className="flex gap-2">
          <Input
            value={nameDraft}
            maxLength={32}
            placeholder="How the other person will see you"
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => setDisplayName(nameDraft)}
            className="max-w-xs"
          />
          <Button variant="secondary" onClick={() => setDisplayName(nameDraft)}>
            Save
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Shown to the other person in the room. Your account name is never used.
        </p>
      </section>

      {!active ? (
        <section className="flex flex-col gap-3">
          <SectionHeading title="Get started" />
          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4" /> Same network (LAN)
                </CardTitle>
                <CardDescription>
                  You are on the same Wi-Fi or router. Nothing travels over the internet.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Button
                  data-party-action="create-lan"
                  disabled={busy}
                  onClick={() => void actions.startHost("lan")}
                >
                  Create room
                </Button>
                <Input
                  data-party-input="address"
                  placeholder="192.168.0.10:54321"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
                <Input
                  data-party-input="pin"
                  placeholder="6-digit PIN"
                  value={pin}
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                />
                <Button
                  variant="secondary"
                  data-party-action="join-lan"
                  disabled={!address.trim() || pin.length !== 6 || busy}
                  onClick={() => void actions.joinLan(address, pin)}
                >
                  Join
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Globe className="h-4 w-4" /> Internet
                </CardTitle>
                <CardDescription>
                  The other person is elsewhere. You exchange two codes — no server, the
                  connection runs directly between the two computers.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Button
                  data-party-action="create-wrtc"
                  disabled={busy}
                  onClick={() => void actions.startHost("webrtc")}
                >
                  Create invite
                </Button>
                <Textarea
                  data-party-input="invite"
                  placeholder="Paste the invite code here (APW1:…)"
                  value={inviteInput}
                  rows={3}
                  className="font-mono text-xs"
                  onChange={(e) => setInviteInput(e.target.value)}
                />
                <Button
                  variant="secondary"
                  data-party-action="join-wrtc"
                  disabled={!inviteInput.trim() || busy}
                  onClick={() => void actions.joinWithCode(inviteInput)}
                >
                  Join
                </Button>
              </CardContent>
            </Card>
          </div>
          <p className="text-xs text-muted-foreground">
            Over a direct connection, some corporate networks or very restrictive NATs can block
            the link. If that happens, use same-network mode.
          </p>
        </section>
      ) : null}

      {/* Host, internet: hand out the invite, take back the answer. */}
      {isHost && overInternet && session.inviteCode ? (
        <section className="flex flex-col gap-3">
          <SectionHeading title="1 · Send this code" />
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              <Textarea
                readOnly
                data-party-invite
                value={session.inviteCode}
                rows={4}
                className="font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <div className="flex items-center gap-2">
                <CopyButton label="invite" value={session.inviteCode} />
                <span className="text-xs text-muted-foreground">
                  Send it over WhatsApp, Discord, anywhere. It is valid for this session only.
                </span>
              </div>
            </CardContent>
          </Card>

          <SectionHeading title="2 · Paste their reply" />
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              <Textarea
                data-party-input="answer"
                placeholder="Paste the answer code here (APW1A:…)"
                value={answerInput}
                rows={3}
                className="font-mono text-xs"
                onChange={(e) => setAnswerInput(e.target.value)}
              />
              <Button
                data-party-action="accept-answer"
                disabled={!answerInput.trim() || busy}
                onClick={() => void actions.acceptAnswerCode(answerInput)}
              >
                <Link2 className="mr-2 h-4 w-4" /> Connect
              </Button>
            </CardContent>
          </Card>
        </section>
      ) : null}

      {/* Guest, internet: send the answer back. */}
      {!isHost && overInternet && session.answerCode ? (
        <section className="flex flex-col gap-3">
          <SectionHeading title="Send this answer code back" />
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              <Textarea
                readOnly
                data-party-answer
                value={session.answerCode}
                rows={4}
                className="font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <div className="flex items-center gap-2">
                <CopyButton label="answer" value={session.answerCode} />
                <span className="text-xs text-muted-foreground">
                  The host pastes it to complete the connection.
                </span>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}

      {/* Host, LAN: address and PIN. */}
      {isHost && !overInternet && session.hostInfo ? (
        <section className="flex flex-col gap-3">
          <SectionHeading title="Share with the other person" />
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Address
                </span>
                {session.hostInfo.addresses.length > 0 ? (
                  session.hostInfo.addresses.map((value) => (
                    <div key={value} className="flex items-center gap-2">
                      <code
                        data-party-address={value}
                        className="rounded-md bg-muted px-2 py-1 font-mono text-sm"
                      >
                        {value}
                      </code>
                      <CopyButton label={value} value={value} />
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No network address found — are you both on the same network?
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  PIN
                </span>
                <div className="flex items-center gap-2">
                  <code
                    data-party-pin={session.hostInfo.pin}
                    className="rounded-md bg-muted px-2 py-1 font-mono text-lg tracking-[0.3em]"
                  >
                    {session.hostInfo.pin}
                  </code>
                  <CopyButton label="pin" value={session.hostInfo.pin} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Nothing leaves your local network.</p>
            </CardContent>
          </Card>
        </section>
      ) : null}

      {active ? (
        <section className="flex flex-col gap-3">
          <SectionHeading title="Participants" />
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="font-medium">{displayName}</span>
              <span className="text-muted-foreground">
                ({isHost ? "host" : "guest"} · {overInternet ? "internet" : "LAN"})
              </span>
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
                  <span className="text-muted-foreground">({isHost ? "guest" : "host"})</span>
                  {isHost && session.guestBuffering ? (
                    <span className="text-amber-500">buffering</span>
                  ) : null}
                </>
              ) : (
                <span className="text-muted-foreground">
                  {isHost
                    ? overInternet
                      ? "Waiting for their reply"
                      : "No guest connected"
                    : "Waiting for the host"}
                </span>
              )}
            </div>
            {isHost && session.latencyMs != null ? (
              <p className="text-xs text-muted-foreground" data-party-latency={session.latencyMs}>
                Latency: {session.latencyMs} ms
              </p>
            ) : null}
            {!isHost && session.lastHeartbeatAt ? (
              <p className="text-xs text-muted-foreground">In contact with the host.</p>
            ) : null}
            {/*
              Always visible over the internet, not only on failure: it is the one
              piece of information that distinguishes "no public address was found"
              from "the networks refuse the direct path", and the user can read it
              out without waiting for something to break.
            */}
            {overInternet && session.diagnostics ? (
              <p
                className="font-mono text-xs text-muted-foreground"
                data-party-diagnostics
              >
                candidates: {session.diagnostics.hostCandidates} host,{" "}
                {session.diagnostics.srflxCandidates} public, {session.diagnostics.relayCandidates}{" "}
                relay · ICE: {session.diagnostics.iceState} · peer:{" "}
                {session.diagnostics.connectionState}
              </p>
            ) : null}
          </div>

          <Button
            variant="secondary"
            className="w-fit"
            data-party-action="leave"
            onClick={() => void actions.leave()}
          >
            <LogOut className="mr-2 h-4 w-4" /> Leave the room
          </Button>
        </section>
      ) : null}

      {active ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Wifi className="h-3.5 w-3.5" />
          Open an episode: the host picks what to watch and the other person follows automatically.
        </p>
      ) : null}
    </div>
  );
}
