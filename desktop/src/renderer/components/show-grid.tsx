import { Flame, ImageOff } from "lucide-react";
import React, { type ReactNode, useState } from "react";

import { cn } from "@/renderer/lib/utils";

export type ShowCardItem = {
  id: string;
  rating?: number;
  coverUrl: string | null;
  /** Typically the show title. */
  title: string;
  /** Optional badges overlaid on the cover (bottom), same pattern as show-details episode cards. */
  badges?: ReactNode;
  /** Called when the item is clicked (e.g. navigate to watch page). */
  onClick: () => void;
};

export const SHOW_GRID_CLASS =
  "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4";

export function ShowCard({
  item,
  layout = "carousel",
}: {
  item: ShowCardItem;
  layout?: "carousel" | "grid";
}) {
  const [failed, setFailed] = useState(false);

  const showFallback = failed || !item.coverUrl;

  return (
    <button
      type="button"
      className={cn(
        "group oa-poster-card text-left focus-visible:outline-none",
        layout === "carousel" && "flex-shrink-0 w-36 sm:w-40",
        layout === "grid" && "w-full min-w-0"
      )}
      {...(layout === "carousel" ? { "data-carousel-item": true } : {})}
      onClick={item.onClick}
      onDragStart={(event) => event.preventDefault()}
    >
      <div className="relative w-full aspect-[2/3] rounded-2xl border-2 border-border transition-all p-[3px] box-border group-hover:border-accent-glow/80 group-hover:shadow-[0_0_0_1px_hsl(var(--accent-glow)/0.7)] group-hover:shadow-lg group-focus-visible:border-accent-glow/80 group-focus-visible:shadow-[0_0_0_1px_hsl(var(--accent-glow)/0.7)]">
        <div className="oa-poster-media relative h-full w-full rounded-xl overflow-hidden bg-muted">
          {showFallback ? (
            <div className="h-full w-full flex items-center justify-center bg-muted-foreground/5 text-muted-foreground/70">
              <ImageOff className="h-6 w-6" aria-hidden="true" />
            </div>
          ) : (
            <img
              src={item.coverUrl ?? undefined}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
              draggable={false}
              onError={() => setFailed(true)}
            />
          )}
          {item.rating != null && (
            <div className="absolute left-2 top-2 z-[1]">
              <span className="flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm">
                <Flame className="h-3 w-3 shrink-0 fill-current text-orange-400" />
                {item.rating}
              </span>
            </div>
          )}
          {/*
            A stronger scrim than the previous single-stop gradient: on bright
            key art the two-line title was sitting on the artwork instead of a
            scrim and became hard to read.
          */}
          <div
            className="absolute inset-0 bg-gradient-to-t from-black/92 via-black/50 to-transparent pointer-events-none"
            aria-hidden
          />
          <div className="absolute bottom-0 left-0 right-0 z-[1] flex flex-col gap-1.5 p-2.5 text-white">
            {item.badges && <div className="flex flex-row flex-wrap gap-1">{item.badges}</div>}
            <p className="line-clamp-2 break-words text-[13px] font-semibold leading-snug drop-shadow-sm">
              {item.title}
            </p>
          </div>
        </div>
      </div>
    </button>
  );
}

type ShowGridProps = {
  items: ShowCardItem[];
  className?: string;
};

export function ShowGrid({ items, className }: ShowGridProps) {
  return (
    <div className={cn(SHOW_GRID_CLASS, className)}>
      {items.map((item) => (
        <ShowCard key={item.id} layout="grid" item={item} />
      ))}
    </div>
  );
}
