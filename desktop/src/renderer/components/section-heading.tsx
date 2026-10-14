import React from "react";

import { cn } from "@/renderer/lib/utils";

/**
 * Section heading for the home page and similar stacked lists.
 *
 * Each section previously hand-rolled an `<h2 class="text-lg font-semibold">`,
 * which produced slightly different sizes and spacing per section and gave no
 * visual link between the heading and the row beneath it. This standardises the
 * rhythm and adds the same palette rule used by `PageHeader`, so page and
 * section headings read as part of one system.
 */
interface SectionHeadingProps {
  title: string;
  /** Optional trailing hint, e.g. a count or a "see all" affordance. */
  meta?: React.ReactNode;
  className?: string;
}

export function SectionHeading({ title, meta, className }: SectionHeadingProps) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", className)}>
      <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <span aria-hidden="true" className="h-4 w-1 rounded-full bg-accent-glow" />
        {title}
      </h2>
      {meta ? <div className="text-xs text-muted-foreground">{meta}</div> : null}
    </div>
  );
}
