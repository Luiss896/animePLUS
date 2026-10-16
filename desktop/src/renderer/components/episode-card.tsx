import React, { type MouseEvent, type ReactNode } from "react";

import { cn } from "@/renderer/lib/utils";
import { Check, Trash2 } from "lucide-react";

/** Renders as `M:SS`, or `H:MM:SS` when an hour or longer. */
function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  }
  return `${m}:${ss}`;
}

function durationBadgeText(totalDurationMs: number, currentDurationMs?: number): string {
  const total = formatDurationMs(totalDurationMs);
  if (currentDurationMs != null && Number.isFinite(currentDurationMs)) {
    return `${formatDurationMs(currentDurationMs)}/${total}`;
  }
  return total;
}

export type EpisodeCardProps = {
  thumbnailUrl?: string | null;
  /** Shown inside the glass badge. Defaults to `Episode {episodeIndex}` when `episodeIndex` is set. */
  badge?: ReactNode;
  episodeIndex?: number;
  /** Line below the badge (e.g. episode title or show name). */
  subtitle?: string | null;
  /**
   * When set, the subtitle becomes a link to the series page rather than part of
   * the card's own action. The card root is a `<button>` (it resumes playback), so
   * this is a `<span role="link">` with `stopPropagation`, not a nested `<a>` —
   * anchors inside buttons are invalid HTML and the outer click would win anyway.
   */
  onSubtitleClick?: () => void;
  /** Accessible label for the subtitle link; required for a useful announcement. */
  subtitleLinkLabel?: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  /** `carousel`: fixed width and `data-carousel-item` for horizontal scroll rows. */
  layout?: "grid" | "carousel";
  /** When set, shows a glass badge top-right: `24:00`, or `12:34/24:00` if `currentDurationMs` is also set. */
  totalDurationMs?: number;
  currentDurationMs?: number;
  /**
   * When set, reveals a delete control in the top-left corner on hover/focus.
   * Used by Continue watching to drop a show from the row.
   */
  onRemove?: () => void;
  /** Accessible label for the delete control; defaults to a generic Remove. */
  removeLabel?: string;
  /** Shows a "Watched" check when the episode has already been seen. */
  watched?: boolean;
};

export function EpisodeCard({
  thumbnailUrl,
  badge,
  episodeIndex,
  subtitle,
  onSubtitleClick,
  subtitleLinkLabel,
  onClick,
  disabled,
  className,
  layout = "grid",
  totalDurationMs,
  currentDurationMs,
  onRemove,
  removeLabel = "Remove",
  watched = false,
}: EpisodeCardProps) {
  const badgeContent = badge ?? (episodeIndex != null ? `Episode ${episodeIndex}` : null);

  const handleRemove = (event: MouseEvent<HTMLSpanElement>) => {
    // The card itself is a <button> whose onClick resumes playback, so the
    // delete control must not let the event bubble up to it.
    event.stopPropagation();
    event.preventDefault();
    onRemove?.();
  };

  const durationLabel =
    totalDurationMs != null && Number.isFinite(totalDurationMs) && totalDurationMs >= 0
      ? durationBadgeText(totalDurationMs, currentDurationMs)
      : null;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...(watched ? { "data-watched-episode": "true" } : {})}
      {...(layout === "carousel" ? { "data-carousel-item": true } : {})}
      className={cn(
        "group oa-poster-card text-left focus-visible:outline-none disabled:opacity-60",
        layout === "carousel" && "flex-shrink-0 w-60 sm:w-72",
        layout === "grid" && "w-full",
        className
      )}
    >
      <div
        className={cn(
          /*
           * Height is content-aware rather than a flat h-40. The bottom overlay
           * now carries a badge plus a two-line title at 13px, which overflowed
           * the old fixed height and clipped the second line.
           */
          "relative w-full rounded-2xl border-2 border-border p-[3px] box-border transition-all group-hover:border-accent-glow/80 group-hover:shadow-[0_0_0_1px_hsl(var(--accent-glow)/0.7)] group-hover:shadow-lg group-focus-visible:border-accent-glow/80 group-focus-visible:shadow-[0_0_0_1px_hsl(var(--accent-glow)/0.7)]",
          layout === "carousel" ? "h-44 sm:h-48" : "h-44"
        )}
      >
        <div className="oa-poster-media relative h-full w-full overflow-hidden rounded-lg bg-muted">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt=""
              draggable={false}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="h-full w-full bg-muted" />
          )}
          {/*
            Two-stop scrim instead of one. A single gradient left the lower third
            of bright thumbnails washed out, so the episode title sat on artwork
            rather than on a scrim and was hard to read.
          */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent" />

          {/*
            Delete control, top-left. It is a <span role="button"> rather than a
            real <button> because the card root is already a <button> and nesting
            them is invalid HTML. Hidden until hover/focus so it does not compete
            with the artwork, but always reachable by keyboard.
          */}
          {onRemove ? (
            <span
              role="button"
              tabIndex={0}
              aria-label={removeLabel}
              title={removeLabel}
              onClick={handleRemove}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onRemove();
                }
              }}
              className="absolute left-2 top-2 z-[2] flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-black/70 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-destructive hover:text-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 group-hover:opacity-100 group-focus-within:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </span>
          ) : null}

          {/*
            Watched marker, top-left. Sits opposite the duration badge and uses a
            filled check on a solid background so it stays legible over any
            artwork. `pointer-events-none` keeps it from stealing the card click,
            and it is aria-hidden because the state is announced on the card's
            own label instead.
          */}
          {watched ? (
            <div className="pointer-events-none absolute left-2 top-2 z-[1]">
              <span
                aria-hidden="true"
                data-episode-watched="true"
                className="flex items-center gap-1 rounded-md bg-emerald-500 px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-sm"
              >
                <Check className="h-3 w-3" strokeWidth={3} />
                Watched
              </span>
            </div>
          ) : null}

          {durationLabel != null ? (
            <div className="pointer-events-none absolute right-2 top-2 z-[1]">
              <span className="rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white backdrop-blur-sm">
                {durationLabel}
              </span>
            </div>
          ) : null}

          <div className="absolute bottom-0 left-0 right-0 flex flex-col items-start gap-1 p-2.5 text-white">
            {badgeContent != null && (
              <span className="rounded-md bg-accent-glow px-1.5 py-0.5 text-[11px] font-semibold text-background shadow-sm">
                {badgeContent}
              </span>
            )}
            {subtitle ? (
              onSubtitleClick ? (
                /*
                 * The series name, as a link. `stopPropagation` is what keeps the
                 * card's own "resume this episode" click from firing, and
                 * `preventDefault` stops the keydown from also activating the
                 * parent button when Enter/Space is pressed on this span.
                 */
                <span
                  role="link"
                  tabIndex={0}
                  aria-label={subtitleLinkLabel ?? subtitle}
                  title={subtitleLinkLabel ?? subtitle}
                  data-episode-subtitle-link="true"
                  onClick={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    onSubtitleClick();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.stopPropagation();
                      event.preventDefault();
                      onSubtitleClick();
                    }
                  }}
                  className="line-clamp-2 cursor-pointer text-[13px] font-semibold leading-snug underline-offset-2 drop-shadow-sm hover:underline focus-visible:underline focus-visible:outline-none"
                >
                  {subtitle}
                </span>
              ) : (
                <p className="line-clamp-2 text-[13px] font-semibold leading-snug drop-shadow-sm">
                  {subtitle}
                </p>
              )
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}
