import { Check } from "lucide-react";
import React, { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { EpisodeCard } from "@/renderer/components/episode-card";
import { HomeHeroCarousel } from "@/renderer/components/home-hero-carousel";
import { HorizontalCarousel } from "@/renderer/components/horizontal-carousel";
import { SectionHeading } from "@/renderer/components/section-heading";
import { Badge } from "@/renderer/components/ui/badge";
import { Skeleton } from "@/renderer/components/ui/skeleton";
import { useResumeHistoryEntry } from "@/renderer/hooks/use-resume-history-entry";
import { showIdCandidates, useWatchedEpisodes } from "@/renderer/hooks/use-watched-episodes";
import { useWelcomeRecentlyUploaded } from "@/renderer/hooks/use-welcome-recent-uploads";
import { useWelcomeRecentlyWatched } from "@/renderer/hooks/use-welcome-recently-watched";
import type { Episode, HistoryEntry } from "@/shared/types";

const RECENT_PAGE_SIZE = 12;

/**
 * Human-readable name for a history entry.
 *
 * The stored `title` is the *show* name, so pairing it with the episode index is
 * what makes a row of continuations readable; previously the card showed only
 * the show name and no episode reference at all beyond the badge. Shared by the
 * card subtitle and the delete control's accessible label so the two cannot
 * drift apart.
 */
function historyEntryLabel(entry: HistoryEntry): string {
  return (
    entry.episode.showName ??
    entry.episode.title.english ??
    entry.episode.title.romanji ??
    entry.episode.title.native ??
    entry.episode.id
  );
}

function RecentUploadsCarouselSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div
      className="flex gap-3 overflow-hidden pb-2 px-8 -mx-8"
      aria-busy="true"
      aria-label="Loading recently uploaded"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex-shrink-0 w-36 sm:w-40">
          <Skeleton className="w-full aspect-[2/3] rounded-2xl" />
        </div>
      ))}
    </div>
  );
}

export function WelcomePage() {
  const navigate = useNavigate();
  const { resumeHistoryEntry, disabledProviderDialog } = useResumeHistoryEntry();
  const { recentUploads, recentUploadsLoading } = useWelcomeRecentlyUploaded(RECENT_PAGE_SIZE);
  const { recentlyWatched, recentlyWatchedLoading, removeRecentlyWatched } =
    useWelcomeRecentlyWatched();
  const { watchedFor } = useWatchedEpisodes();

  const openRecentAnime = useCallback(
    (episode: Episode) => {
      navigate("/watch", { state: { episode } });
    },
    [navigate]
  );

  /**
   * Open the series page for a history entry.
   *
   * `providerId` goes in the query string because the details route reads it from
   * there (`show-details-page.tsx`), and without it the page cannot tell which
   * provider's id this is and reports "No episodes available".
   */
  /**
   * Open the series page for a history entry.
   *
   * Two things are passed, and both are required:
   *
   *  - `providerId` in the query string, because that is where the details route
   *    reads it (`show-details-page.tsx`); without it the page reports "No
   *    episodes available".
   *  - `provider` in the route state, because **the id only means something to the
   *    provider that issued it**. History keeps one entry per provider, so an id
   *    saved while AnimeUnity was active is an AnimeUnity id; opening the page
   *    while HiAnime is the configured default makes the details route try that
   *    foreign id on the wrong host, which answers 404 (HiAnime) or 405
   *    (AnimeUnity). Passing the originating provider pins the lookup to the host
   *    that can actually resolve it.
   */
  const openShowPage = useCallback(
    (entry: HistoryEntry) => {
      const providerId = entry.episode.providerId || entry.episode.id;
      if (!providerId) return;
      const params = new URLSearchParams({ providerId });
      navigate(`/show/${encodeURIComponent(providerId)}?${params.toString()}`, {
        state: { provider: entry.provider },
      });
    },
    [navigate]
  );

  return (
    <div className="oa-page-enter w-full max-w-[1600px] mx-auto flex flex-col gap-6 p-6 md:p-8">
      {disabledProviderDialog}
      <>
        <div className="-mt-6 -mx-6 md:-mt-8 md:-mx-8">
          <HomeHeroCarousel />
        </div>
        <section className="flex flex-col gap-3" data-home-row="continue">
          <SectionHeading title="Continue watching" />
          {recentlyWatchedLoading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : recentlyWatched.length > 0 ? (
            <HorizontalCarousel>
              {recentlyWatched.map((entry) => {
                /*
                 * Continue watching is one row per *show*, so an entry appears
                 * here only while its episode is the latest one for that show.
                 * The entry that reaches this row is therefore normally already
                 * past the completion mark, and "Watched" would be noise; the
                 * marker is limited to entries that are finished while still
                 * being the show's most recent — which does happen when a later
                 * episode was never opened.
                 */
                const watched = watchedFor(
                  showIdCandidates(entry.episode.id, entry.episode.providerId)
                );
                const label = historyEntryLabel(entry);
                return (
                  <EpisodeCard
                    key={entry.id}
                    layout="carousel"
                    thumbnailUrl={entry.episode.thumbnail}
                    badge={`Episode ${String(entry.episode.index)}`}
                    subtitle={label}
                    watched={watched?.has(entry.episode.index) ?? false}
                    onSubtitleClick={() => openShowPage(entry)}
                    subtitleLinkLabel={`Open the series page for ${label}`}
                    onClick={() => {
                      resumeHistoryEntry(entry);
                    }}
                    totalDurationMs={entry.totalDurationMs}
                    currentDurationMs={entry.currentDurationMs}
                    onRemove={() => {
                      void removeRecentlyWatched(entry.id);
                    }}
                    removeLabel={`Remove ${label} from Continue watching`}
                  />
                );
              })}
            </HorizontalCarousel>
          ) : (
            <p className="text-muted-foreground text-sm">No recently watched anime.</p>
          )}
        </section>
        <section className="flex flex-col gap-3" data-home-row="recent">
          <SectionHeading title="Recently uploaded" />
          {recentUploadsLoading ? (
            <RecentUploadsCarouselSkeleton />
          ) : recentUploads.length > 0 ? (
            <HorizontalCarousel
              items={recentUploads.map((episode) => {
                // Recent uploads are keyed by the provider slug, which is the same
                // identity history records, so the alias lookup matches directly.
                const watched = watchedFor(showIdCandidates(episode.id, episode.providerId));
                const isWatched = watched?.has(episode.index) ?? false;
                return {
                  id: `${episode.id || episode.providerId}-${episode.index}-${episode.mode}`,
                  coverUrl: episode.thumbnail,
                  title:
                    episode.title.english ??
                    episode.title.romanji ??
                    episode.title.native ??
                    episode.providerId,
                  badges: (
                    <>
                      <Badge
                        variant="glass"
                        className="text-white flex items-center gap-1 align-middle"
                      >
                        {`Episode ${episode.index}`}
                      </Badge>
                      {isWatched ? (
                        <Badge
                          variant="glass"
                          data-episode-watched="true"
                          className="flex items-center gap-1 bg-emerald-500 align-middle text-white"
                        >
                          <Check className="h-3 w-3" strokeWidth={3} />
                          Watched
                        </Badge>
                      ) : null}
                    </>
                  ),
                  onClick: () => openRecentAnime(episode),
                };
              })}
            />
          ) : (
            <p className="text-muted-foreground text-sm">No recent anime found.</p>
          )}
        </section>
      </>
    </div>
  );
}
