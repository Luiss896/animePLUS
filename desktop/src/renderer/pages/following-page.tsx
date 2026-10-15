import { CalendarDays, Clock, Loader2, PlusCircle, RefreshCw, Sparkles, Tv } from "lucide-react";
import React, { useMemo } from "react";

import { Badge } from "@/renderer/components/ui/badge";
import { Button } from "@/renderer/components/ui/button";
import { Card } from "@/renderer/components/ui/card";
import { PageHeader } from "@/renderer/components/page-header";
import { useUpcomingSeasons } from "@/renderer/hooks/use-upcoming-seasons";
import type {
  AiringShow,
  AutoAddResult,
  UpcomingSeason,
  UpcomingSeasonsResult,
} from "@/shared/upcoming-seasons-types";

const SEASON_LABELS: Record<string, string> = {
  WINTER: "Winter",
  SPRING: "Spring",
  SUMMER: "Summer",
  FALL: "Fall",
};

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Weekday order used for the Ongoing section, starting from today. */
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Render a season/year as a human label.
 *
 * AniList's dates are fuzzy: the year is usually present, the month often, the
 * exact day rarely. So the label degrades from "October 20, 2027" to
 * "October 2027" to "Fall 2027" to "2027" rather than showing blank parts.
 */
function formatPremiere(season: UpcomingSeason): string {
  const { startDate, seasonYear } = season;
  const year = startDate?.year ?? seasonYear;

  if (startDate?.month != null) {
    const month = MONTH_LABELS[startDate.month - 1] ?? null;
    if (month && startDate.day != null) return `${month} ${startDate.day}, ${year}`;
    if (month) return `${month} ${year}`;
  }

  const seasonLabel = season.season ? SEASON_LABELS[season.season] : null;
  if (seasonLabel && year) return `${seasonLabel} ${year}`;
  if (year) return String(year);
  return "Date to be announced";
}

/** Whole months until the premiere, or null when the date is too vague. */
function monthsUntil(season: UpcomingSeason): number | null {
  const year = season.startDate?.year ?? season.seasonYear;
  const month = season.startDate?.month;
  if (year == null || month == null) return null;

  const now = new Date();
  const months = (year - now.getFullYear()) * 12 + (month - (now.getMonth() + 1));
  return months < 0 ? null : months;
}

function relativePremiere(season: UpcomingSeason): string | null {
  const months = monthsUntil(season);
  if (months == null) return null;
  if (months === 0) return "this month";
  if (months === 1) return "next month";
  if (months < 12) return `in ${months} months`;
  const years = Math.floor(months / 12);
  return years === 1 ? "in about a year" : `in about ${years} years`;
}

/** Local clock time of the next episode, e.g. "16:56". */
function formatAiringTime(airingAtMs: number | null): string | null {
  if (airingAtMs == null) return null;
  const date = new Date(airingAtMs);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * Human countdown to the next episode.
 *
 * Deliberately coarse: the value is only refreshed when the page loads, so
 * showing minutes would be misleading within a minute of it going stale.
 */
function formatCountdown(timeUntilAiring: number | null): string | null {
  if (timeUntilAiring == null || timeUntilAiring <= 0) return null;
  const hours = timeUntilAiring / 3600;
  if (hours < 1) return "in under an hour";
  if (hours < 24) return `in ${Math.round(hours)}h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

/* -------------------------------------------------------------------------- */
/* Cards                                                                      */
/* -------------------------------------------------------------------------- */

function Cover({ src, className }: { src: string | null; className?: string }) {
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-lg bg-muted ${className ?? ""}`}>
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : null}
    </div>
  );
}

function AiringCard({ show, index }: { show: AiringShow; index: number }) {
  const time = formatAiringTime(show.airingAtMs);
  const countdown = formatCountdown(show.timeUntilAiring);

  return (
    <Card
      interactive
      padding="none"
      className="oa-stagger group flex gap-3 p-3"
      style={{ "--oa-i": index } as React.CSSProperties}
    >
      <Cover src={show.coverImage} className="h-24 w-16" />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="min-w-0 text-sm font-semibold leading-snug line-clamp-2">{show.title}</h3>

        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {time ? (
            <span className="flex items-center gap-1 font-medium text-foreground/90">
              <Clock className="h-3 w-3 shrink-0" />
              {time}
            </span>
          ) : null}
          {countdown ? <span className="text-accent-glow">{countdown}</span> : null}
        </p>

        <p className="text-xs text-muted-foreground">
          {show.nextEpisode != null ? (
            <>
              Episode <span className="text-foreground/80">{show.nextEpisode}</span>
              {show.totalEpisodes ? <span className="opacity-60"> / {show.totalEpisodes}</span> : null}
            </>
          ) : (
            "Next episode to be announced"
          )}
        </p>

        {show.isOnList === false ? (
          <Badge variant="secondary" className="w-fit text-[10px]">
            New season
          </Badge>
        ) : !show.isBeingWatched ? (
          <Badge variant="secondary" className="w-fit text-[10px]">
            On your list
          </Badge>
        ) : null}
      </div>
    </Card>
  );
}

function UpcomingCard({ season, index }: { season: UpcomingSeason; index: number }) {
  const premiere = formatPremiere(season);
  const relative = relativePremiere(season);

  return (
    <Card
      interactive
      padding="none"
      className="oa-stagger group flex gap-3 p-3"
      style={{ "--oa-i": index } as React.CSSProperties}
    >
      <Cover src={season.coverImage} className="h-24 w-16" />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="min-w-0 text-sm font-semibold leading-snug line-clamp-2">
          {season.title}
        </h3>

        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CalendarDays className="h-3 w-3 shrink-0" />
            {premiere}
          </span>
          {relative ? <span className="text-accent-glow">{relative}</span> : null}
        </p>

        <p className="truncate text-xs text-muted-foreground">
          From <span className="text-foreground/80">{season.source.title}</span>
        </p>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Group airing shows by local weekday, ordered starting from today.
 *
 * Starting at today rather than Monday is what makes the section useful: what
 * airs later today is the thing a viewer actually cares about first.
 */
function groupAiringByWeekday(shows: AiringShow[]) {
  const today = new Date().getDay();
  const order = Array.from({ length: 7 }, (_, i) => (today + i) % 7);

  return order
    .map((weekdayIndex) => ({
      weekdayIndex,
      label:
        weekdayIndex === today
          ? "Today"
          : weekdayIndex === (today + 1) % 7
            ? "Tomorrow"
            : WEEKDAY_NAMES[weekdayIndex],
      shows: shows.filter((show) => show.weekdayIndex === weekdayIndex),
    }))
    .filter((group) => group.shows.length > 0);
}

function SectionHeading({
  icon,
  title,
  count,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-accent-glow">{icon}</span>
      <div className="space-y-0.5">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          {title}
          <Badge variant="secondary" className="text-[10px]">
            {count}
          </Badge>
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export function FollowingPage() {
  const { result, loading, refresh, autoAdd } = useUpcomingSeasons();

  const openOnAniList = (mediaId: number) => {
    const url = `https://anilist.co/anime/${mediaId}`;
    if (window.urlOpener) {
      void window.urlOpener.openUrl(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="oa-page-enter w-full max-w-[1600px] mx-auto flex flex-col gap-8 p-6 md:p-8">
      <PageHeader
        title="Following"
        description="What is airing now and what is coming next, from your AniList list."
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </Button>
        }
      />

      {loading && !result ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking your list…
        </div>
      ) : (
        <>
          <AutoAddNotice autoAdd={autoAdd} />
          <FollowingContent result={result} onOpen={openOnAniList} onRefresh={refresh} />
        </>
      )}
    </div>
  );
}

/**
 * Reports the outcome of an automatic sequel-tracking pass.
 *
 * Rendered only when the feature is on and it actually did something, so it
 * never becomes permanent chrome for users who leave the setting off.
 */
function AutoAddNotice({ autoAdd }: { autoAdd: AutoAddResult | null }) {
  if (!autoAdd || !autoAdd.enabled) return null;
  if (autoAdd.added.length === 0 && !autoAdd.error) return null;

  return (
    <Card padding="sm" variant="muted" className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm">
        <PlusCircle className="h-4 w-4 shrink-0 text-accent-glow" />
        <span>
          {autoAdd.added.length === 0
            ? "Automatic season tracking could not run."
            : autoAdd.added.length === 1
              ? "Added 1 new season to your AniList list as Planning."
              : `Added ${autoAdd.added.length} new seasons to your AniList list as Planning.`}
        </span>
      </div>

      {autoAdd.added.length > 0 ? (
        <ul className="flex flex-col gap-1 pl-6 text-xs text-muted-foreground">
          {autoAdd.added.slice(0, 5).map((item) => (
            <li key={item.mediaId} className="truncate">
              {item.title} <span className="opacity-70">— from {item.fromTitle}</span>
            </li>
          ))}
          {autoAdd.added.length > 5 ? (
            <li className="opacity-70">and {autoAdd.added.length - 5} more…</li>
          ) : null}
        </ul>
      ) : null}

      {autoAdd.truncated ? (
        <p className="pl-6 text-xs text-muted-foreground">
          More sequels were found than the per-run limit allows; the rest will be added next time.
        </p>
      ) : null}

      {autoAdd.error ? <p className="pl-6 text-xs text-destructive">{autoAdd.error}</p> : null}
    </Card>
  );
}

function FollowingContent({
  result,
  onOpen,
  onRefresh,
}: {
  result: UpcomingSeasonsResult | null;
  onOpen: (mediaId: number) => void;
  onRefresh: () => void;
}) {
  const groups = useMemo(
    () => (result?.status === "ok" ? groupAiringByWeekday(result.airing) : []),
    [result]
  );

  if (!result) return null;

  if (result.status !== "ok") {
    return <StateMessage result={result} onRefresh={onRefresh} />;
  }

  const hasAiring = result.airing.length > 0;
  const hasUpcoming = result.seasons.length > 0;
  const todayIndex = new Date().getDay();

  return (
    <div className="flex flex-col gap-10">
      {hasAiring ? (
        <section className="flex flex-col gap-4">
          <SectionHeading
            icon={<Tv className="h-5 w-5" />}
            title="Airing now"
            count={result.airing.length}
            description="Shows from your list with an episode scheduled, grouped by day in your local time."
          />

          <div className="flex flex-col gap-6">
            {groups.map((group) => (
              <div key={group.weekdayIndex} className="flex flex-col gap-3">
                <h3
                  className={
                    group.weekdayIndex === todayIndex
                      ? "text-sm font-semibold text-accent-glow"
                      : "text-sm font-semibold text-muted-foreground"
                  }
                >
                  {group.label}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {group.shows.map((show, index) => (
                    <ClickableCard
                      key={show.mediaId}
                      mediaId={show.mediaId}
                      onOpen={onOpen}
                      label={show.title}
                    >
                      <AiringCard show={show} index={index} />
                    </ClickableCard>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {hasUpcoming ? (
        <section className="flex flex-col gap-4">
          <SectionHeading
            icon={<CalendarDays className="h-5 w-5" />}
            title="Upcoming seasons"
            count={result.seasons.length}
            description="Announced future seasons of shows you follow."
          />

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {result.seasons.map((season, index) => (
              <ClickableCard
                key={season.mediaId}
                mediaId={season.mediaId}
                onOpen={onOpen}
                label={season.title}
              >
                <UpcomingCard season={season} index={index} />
              </ClickableCard>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** Keyboard-accessible wrapper that opens the AniList page for a show. */
function ClickableCard({
  mediaId,
  onOpen,
  label,
  children,
}: {
  mediaId: number;
  onOpen: (mediaId: number) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${label} on AniList`}
      onClick={() => {
        onOpen(mediaId);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(mediaId);
        }
      }}
      className="cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </div>
  );
}

function StateMessage({
  result,
  onRefresh,
}: {
  result: Exclude<UpcomingSeasonsResult, { status: "ok" }>;
  onRefresh: () => void;
}) {
  // A switch narrows the union properly; an object literal keyed by status
  // would not, which is why the copy is built here.
  let title: string;
  let description: string;

  switch (result.status) {
    case "not-connected":
      title = "Connect AniList to use this page";
      description =
        "Following reads the anime on your AniList list to show what is airing and what is coming next. Connect your account in Settings.";
      break;
    case "empty":
      title = "Nothing airing or announced";
      description =
        "No show on your list has a scheduled episode or an announced future season yet. This updates as schedules are published.";
      break;
    case "rate-limited":
      title = "AniList is rate limiting requests";
      description = `Too many requests were made. Try again in about ${result.retryAfterSeconds} seconds.`;
      break;
    case "error":
      title = "Could not load your list";
      description = result.message;
      break;
  }

  return (
    <Card className="flex flex-col items-center gap-3 py-10 text-center">
      <Sparkles className="h-6 w-6 text-accent-glow" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
      {result.status !== "not-connected" ? (
        <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4" />
          {result.status === "empty" ? "Check again" : "Retry"}
        </Button>
      ) : null}
    </Card>
  );
}
