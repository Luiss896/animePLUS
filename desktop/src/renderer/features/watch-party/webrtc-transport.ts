import { parsePartyMessage } from "@/shared/watch-party/protocol";

import {
  ANSWER_CODE_PREFIX,
  CURRENT_INVITE_VERSION,
  decodeAnswer,
  decodeInvite,
  encodeAnswer,
  encodeInvite,
  INVITE_CODE_PREFIX,
} from "./invite-code";
import type {
  PartyDiagnostics,
  PartyTransport,
  PartyTransportHandlers,
} from "./transport";

/**
 * WebRTC transport, for parties that are not on the same network.
 *
 * Runs in the renderer because `RTCPeerConnection` is a Chromium API — there is no
 * Node-side WebRTC library involved. The only external touchpoint is a public STUN
 * server, needed to discover the public address for NAT traversal; no server of
 * ours is added.
 *
 * ## Signalling without a server
 *
 * There is no signalling service. The host produces an invite code, the guest
 * answers with an answer code, and the two are exchanged by hand through whatever
 * the users are already talking on. That costs two copy-pastes to start a session
 * and buys a party that depends on nothing we operate.
 *
 * ## Non-trickle ICE, deliberately
 *
 * Candidates are waited for before the code is produced, because a code has to be
 * a single self-contained blob — there is no channel to trickle them over yet. That
 * makes setup slower by a second or two than a trickling connection would be, which
 * is the right trade for something the user is pasting into a chat window.
 */

/**
 * Public STUN servers. Free, no account, and not operated by this project.
 *
 * Several rather than one because a single server is a single point of failure, and
 * because a server-reflexive candidate is the *only* way two peers on different
 * networks can find each other: with none, the party silently degrades to
 * same-network-only. Chromium's own defaults list several for the same reason.
 *
 * Reading the diagnostics needs care here. A peer reporting `0 public` does not by
 * itself mean STUN failed: once ICE finds a working pair it stops gathering, so a
 * same-network connection is established and gathering is truncated before the STUN
 * reply arrives. That is exactly what two instances on one machine show — the first
 * peer reports one public candidate and the second none. STUN on this host was
 * confirmed working separately (6 host + 1 srflx from a standalone gather). In a
 * *failed* connection, where nothing ever connected and gathering ran to completion,
 * a missing public candidate is meaningful.
 */
const ICE_SERVERS: RTCIceServer[] = [
  {
    urls: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
      "stun:stun2.l.google.com:19302",
    ],
  },
  { urls: "stun:stun.cloudflare.com:3478" },
];

/** How long to wait for ICE gathering before sending what we have. */
const ICE_GATHER_TIMEOUT_MS = 6000;

/**
 * Give up if the peer never completes the handshake.
 *
 * Generous on purpose: the guest's channel cannot arrive until a human has copied
 * the answer code into a chat window and the host has pasted it back. Anything
 * short would time out on a slow typist rather than on a real failure.
 */
const HANDSHAKE_TIMEOUT_MS = 10 * 60_000;

/**
 * Wait until ICE has finished gathering.
 *
 * Resolves on the timeout as well: gathering can stop early when a network blocks
 * STUN, and a code built from host candidates alone still works between two
 * machines that can reach each other directly.
 */
function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (pc.iceGatheringState !== "complete") return;
      pc.removeEventListener("icegatheringstatechange", done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", done);
      resolve();
    }, ICE_GATHER_TIMEOUT_MS);
    pc.addEventListener("icegatheringstatechange", done);
  });
}

/**
 * A `PartyTransport` whose `send` works only once the channel is open.
 *
 * Frames written before that are queued rather than dropped: the session sends
 * `hello` the moment it is told the party is connected, and an early flush would
 * lose it and leave the guest with no host name.
 */
/**
 * Report what the connection attempt is actually doing.
 *
 * A failed party currently reads as a bare "could not connect", which is the same
 * message for two very different problems: the two machines cannot reach each other
 * (no working candidate pair — usually NAT, and unfixable without a relay), or the
 * codes were exchanged too slowly. Counting candidate kinds separates them: no
 * `srflx` means no public address was discovered, so only same-network peers can
 * ever connect.
 */
function trackDiagnostics(pc: RTCPeerConnection, handlers: PartyTransportHandlers): void {
  const counts = { host: 0, srflx: 0, relay: 0 };
  let publicAddressFound = false;

  const report = (): void => {
    handlers.onDiagnostics?.({
      hostCandidates: counts.host,
      srflxCandidates: counts.srflx,
      relayCandidates: counts.relay,
      iceState: pc.iceConnectionState,
      connectionState: pc.connectionState,
      publicAddressFound,
    });
  };

  pc.addEventListener("icecandidate", (event) => {
    if (!event.candidate) return;
    const type = event.candidate.type ?? "host";
    if (type === "host") counts.host += 1;
    else if (type === "srflx") {
      counts.srflx += 1;
      publicAddressFound = true;
    } else if (type === "relay") {
      counts.relay += 1;
    }
    report();
  });
  pc.addEventListener("iceconnectionstatechange", report);
  pc.addEventListener("connectionstatechange", report);
  report();
}

/** The honest explanation for a peer connection that never came up. */
function describeFailure(info: PartyDiagnostics | null): string {
  if (info && !info.publicAddressFound) {
    return "No public address could be discovered (STUN unreachable), so only two computers on the same network can connect.";
  }
  return "The two computers could not reach each other directly. This usually means one of the networks blocks peer-to-peer traffic — corporate networks and some providers do. Same-network mode still works.";
}

/**
 * A `PartyTransport` whose `send` works only once the channel is open.
 *
 * Takes a *promise* for the channel rather than the channel itself. The guest does
 * not have one yet when its transport must be handed back: it has to give the user
 * the answer code first, and the host cannot connect until that code arrives. An
 * earlier revision awaited the channel before returning, which deadlocked both
 * sides — the guest waited for a connection that could not be made until it let go
 * of the code.
 *
 * Frames written before the channel opens are queued rather than dropped: the
 * session sends `hello` the moment it is told the party is connected, and an early
 * flush would lose it and leave the guest with no host name.
 */
function createDataChannelTransport(
  pc: RTCPeerConnection,
  channelPromise: Promise<RTCDataChannel>,
  handlers: PartyTransportHandlers,
  /**
   * Which side sent the messages that arrive here.
   *
   * Validated on receipt exactly as the LAN path does in main: without it a peer
   * could send host commands at the host, or a `ready` at a guest, and the session
   * would act on them.
   */
  inboundFrom: "host" | "guest"
): PartyTransport {
  const queue: string[] = [];
  let closed = false;
  let channel: RTCDataChannel | null = null;
  /** Whether the channel ever reached `open`, which decides how a failure reads. */
  let everOpened = false;
  /** Latest diagnostics, so a failure can explain itself instead of guessing. */
  let lastDiagnostics: PartyDiagnostics | null = null;

  const previousDiagnostics = handlers.onDiagnostics;
  handlers.onDiagnostics = (info) => {
    lastDiagnostics = info;
    previousDiagnostics?.(info);
  };

  const flush = () => {
    if (!channel || channel.readyState !== "open") return;
    while (queue.length > 0) {
      const payload = queue.shift();
      if (payload === undefined) break;
      try {
        channel.send(payload);
      } catch {
        // Channel closed between the check and the send; the status handler below
        // reports the disconnection.
        break;
      }
    }
  };

  void channelPromise
    .then((openedChannel) => {
      channel = openedChannel;
      openedChannel.addEventListener("open", () => {
        everOpened = true;
        handlers.onStatus({ state: "connected" });
        flush();
      });
      openedChannel.addEventListener("close", () => {
        if (!closed) handlers.onStatus({ state: "closed" });
      });
      openedChannel.addEventListener("message", (event) => {
        const data = typeof event.data === "string" ? event.data : "";
        if (!data) return;
        // Malformed or wrong-direction frames are dropped, never acted on.
        const parsed = parsePartyMessage(data, inboundFrom);
        if (parsed) handlers.onMessage(parsed);
      });
      // The channel may already be open by the time this resolves.
      if (openedChannel.readyState === "open") {
        everOpened = true;
        handlers.onStatus({ state: "connected" });
        flush();
      }
    })
    .catch((error: unknown) => {
      handlers.onStatus({
        state: "error",
        error: error instanceof Error ? error.message : "Channel unavailable",
      });
    });

  pc.addEventListener("connectionstatechange", () => {
    const state = pc.connectionState;
    if (state !== "failed") {
      if (state === "disconnected" && everOpened) handlers.onStatus({ state: "closed" });
      return;
    }

    if (everOpened) {
      // It was working and stopped: a real failure.
      handlers.onStatus({ state: "error", error: describeFailure(lastDiagnostics) });
      return;
    }

    /*
     * Failed before the channel ever opened, which on the guest is the normal state
     * while the host has not pasted the answer code yet: its ICE has nothing to talk
     * to and gives up after roughly thirty seconds, then revives on its own once the
     * host applies the answer. Reporting that as a fatal error accused the user of a
     * failure that had not happened — and the message then outlived the problem,
     * sitting above a green "Connected" badge.
     */
    handlers.onStatus({
      state: "connecting",
      notice:
        "Waiting for the host to paste your answer code. If they already did and this persists, one of the networks is blocking the direct connection.",
    });
  });

  return {
    kind: "webrtc",
    send(message) {
      const payload = JSON.stringify(message);
      if (channel?.readyState === "open") {
        try {
          channel.send(payload);
          return Promise.resolve({ ok: true });
        } catch (error: unknown) {
          return Promise.resolve({
            ok: false,
            error: error instanceof Error ? error.message : "Send failed",
          });
        }
      }
      // Queued rather than refused: the session sends `hello` the instant it is
      // told the party is connected, which can precede the channel opening.
      if (channel === null || channel.readyState === "connecting") {
        queue.push(payload);
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({ ok: false, error: "Channel is not open" });
    },
    close() {
      closed = true;
      try {
        channel?.close();
      } catch {
        /* already gone */
      }
      pc.close();
      return Promise.resolve();
    },
  };
}

export interface WebRtcHostSession {
  inviteCode: string;
  transport: PartyTransport;
  /** Complete the handshake with the code the guest sent back. */
  acceptAnswer(answerCode: string): Promise<void>;
}

/**
 * Host side: produce an invite code and wait for the guest's answer.
 *
 * The transport is returned immediately so the caller can hook status and message
 * handlers before the peer arrives; nothing is sent until the channel opens.
 */
export async function createWebRtcHost(
  handlers: PartyTransportHandlers,
  displayName: string,
  pin: string
): Promise<WebRtcHostSession> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const channel = pc.createDataChannel("party", { ordered: true });
  trackDiagnostics(pc, handlers);
  // Host receives from the guest. The channel exists already; hand it over resolved.
  const transport = createDataChannelTransport(pc, Promise.resolve(channel), handlers, "guest");

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGathering(pc);

  const inviteCode = await encodeInvite({
    v: CURRENT_INVITE_VERSION,
    pin,
    host: displayName,
    sdp: pc.localDescription?.sdp ?? "",
  });

  return {
    inviteCode,
    transport,
    async acceptAnswer(answerCode: string) {
      const answer = await decodeAnswer(answerCode);
      if (!answer) {
        throw new Error(
          `Codice di risposta non valido: incolla quello che inizia con ${ANSWER_CODE_PREFIX}`
        );
      }
      if (pc.signalingState === "closed") throw new Error("Session closed");
      await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
      handlers.onStatus({ state: "connecting" });
    },
  };
}

export interface WebRtcGuestSession {
  answerCode: string;
  transport: PartyTransport;
}

/**
 * Guest side: consume an invite and produce the answer code to send back.
 *
 * The PIN from the invite is returned alongside so the caller can hand it to the
 * session, which announces it so the host can confirm it invited this peer.
 */
export async function createWebRtcGuest(
  handlers: PartyTransportHandlers,
  inviteCode: string
): Promise<WebRtcGuestSession & { pin: string; hostName: string }> {
  const invite = await decodeInvite(inviteCode);
  if (!invite) {
    throw new Error(
      `Codice invito non valido: incolla quello che inizia con ${INVITE_CODE_PREFIX}`
    );
  }

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  trackDiagnostics(pc, handlers);

  const opened = new Promise<RTCDataChannel>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The host did not answer in time")),
      HANDSHAKE_TIMEOUT_MS
    );
    pc.addEventListener("datachannel", (event) => {
      clearTimeout(timer);
      resolve(event.channel);
    });
  });

  handlers.onStatus({ state: "connecting" });

  await pc.setRemoteDescription({ type: "offer", sdp: invite.sdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceGathering(pc);

  const answerCode = await encodeAnswer({
    v: CURRENT_INVITE_VERSION,
    sdp: pc.localDescription?.sdp ?? "",
  });

  /*
   * The transport is built around the *promise* of the host's channel and returned
   * now, before that channel exists. Waiting for it here would deadlock: the host
   * cannot open a connection until the user delivers this answer code, and the code
   * would never be returned while we waited for the connection.
   */
  const transport = createDataChannelTransport(pc, opened, handlers, "host");

  return { answerCode, transport, pin: invite.pin, hostName: invite.host };
}
