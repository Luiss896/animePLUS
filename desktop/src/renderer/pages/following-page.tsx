import { CalendarDays, ExternalLink, Loader2, RefreshCw, Sparkles } from "lucide-react";
import React from "react";

import { useUpcomingSeasons } from "@/renderer/hooks/use-upcoming-seasons";
import { Badge } from "@/renderer/components/ui/badge";
import { Button } from "@/renderer/components/ui/button";
import { Card } from "@/renderer/components/ui/card";
import type { UpcomingSeason, UpcomingSeasonsResult } from "@/shared/upcoming-seasons-types";

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

/**
 * Whole months until the premiere, or null when the date is not precise enough
 * to make an honest claim. Used for the "in 8 months" hint.
 */
function monthsUntil(season: UpcomingSeason): number | null {
  const year = season.startDate?.year ?? season.seasonYear;
  const month = season.startDate?.month;
  if (year == null || month == null) return null;

  const now = new Date();
  const months = (year - now.getFullYear()) * 12 + (month - (now.getMonth() + 1));
  return months < 0 ? null : months;
}

function relativeLabel(season: UpcomingSeason): string | null {
  const months = monthsUntil(season);
  if (months == null) return null;
  if (months === 0) return "this month";
  if (months === 1) return "next month";
  if (months < 12) return `in ${months} months`;
  const years = Math.floor(months / 12);
  return years === 1 ? "in about a year" : `in about ${years} years`;
}

function UpcomingCard({ season, index }: { season: UpcomingSeason; index: number }) {
  const premiere = formatPremiere(season);
  const relative = relativeLabel(season);

  return (
    <Card
      interactive
      padding="none"
      className="oa-stagger group flex gap-3 overflow-hidden p-3"
      style={{ "--oa-i": index } as React.CSSProperties}
    >
      <div className="relative h-28 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
        {season.coverImage ? (
          <img
            src={season.coverImage}
            alt=""
            draggable={false}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-sm font-semibold leading-snug">{season.title}</h3>
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            Season {season.hops + 1}
          </Badge>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{premiere}</span>
          {relative ? <span className="text-accent-glow shrink-0">· {relative}</span> : null}
        </p>

        <p className="truncate text-xs text-muted-foreground">
          From your list: <span className="text-foreground/80">{season.source.title}</span>
        </p>
      </div>
    </Card>
  );
}

function StateMessage({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-3 py-10 text-center">
      <Sparkles className="h-6 w-6 text-accent-glow" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </Card>
  );
}

export function FollowingPage() {
  const { result, loading, refresh } = useUpcomingSeasons();

  const openOnAniList = (mediaId: number) => {
    const url = `https://anilist.co/anime/${mediaId}`;
    if (window.urlOpener) {
      void window.urlOpener.openUrl(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="oa-page-enter w-full max-w-[1600px] mx-auto flex flex-col gap-6 p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-4xl font-semibold tracking-tight">Following</h1>
          <p className="text-sm text-muted-foreground">
            Upcoming seasons of shows on your AniList list.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={loading}
          className="shrink-0"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      {loading && !result ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking your list…
        </div>
      ) : (
        <FollowingContent
          result={result}
          onOpen={openOnAniList}
          onRefresh={refresh}
        />
      )}
    </div>
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
  if (!result) return null;

  switch (result.status) {
    case "not-connected":
      return (
        <StateMessage
          title="Connect AniList to see upcoming seasons"
          description="This page reads the anime on your AniList list and looks for announced sequels. Connect your account in Settings to use it."
        />
      );

    case "empty":
      return (
        <StateMessage
          title="No upcoming seasons found"
          description="None of the shows on your list has an announced sequel yet. This updates as studios make announcements."
          action={
            <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
              <RefreshCw className="h-4 w-4" />
              Check again
            </Button>
          }
        />
      );

    case "rate-limited":
      return (
        <StateMessage
          title="AniList is rate limiting requests"
          description={`Too many requests were made. Try again in about ${result.retryAfterSeconds} seconds.`}
          action={
            <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
          }
        />
      );

    case "error":
      return (
        <StateMessage
          title="Could not load upcoming seasons"
          description={result.message}
          action={
            <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          }
        />
      );

    case "ok":
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {result.seasons.length === 1
              ? "1 upcoming season found"
              : `${result.seasons.length} upcoming seasons found`}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {result.seasons.map((season, index) => (
              <div
                key={season.mediaId}
                role="button"
                tabIndex={0}
                onClick={() => {
                  onOpen(season.mediaId);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(season.mediaId);
                  }
                }}
                className="cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <UpcomingCard season={season} index={index} />
              </div>
            ))}
          </div>
        </div>
      );
  }
}
