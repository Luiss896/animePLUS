import React from "react";

import { cn } from "@/renderer/lib/utils";

/**
 * Page header used across the app.
 *
 * Pages previously each hand-rolled an `<h1 class="text-4xl font-semibold">`
 * followed by a paragraph, which drifted in spacing and gave every screen the
 * same flat, undifferentiated top. Centralising it keeps the rhythm identical
 * everywhere and gives the redesign one place to add the accent treatment.
 *
 * The heading uses a tight tracking and a subtle two-tone treatment: a short
 * palette-coloured rule sits above the title, which reads as intentional without
 * adding decoration that competes with content.
 */
interface PageHeaderProps {
  title: string;
  description?: string;
  /** Optional control rendered on the right, e.g. a refresh button. */
  action?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, action, className }: PageHeaderProps) {
  return (
    <div
      className={cn("flex flex-wrap items-end justify-between gap-4 pb-1", className)}
    >
      <div className="min-w-0 space-y-2">
        <span
          aria-hidden="true"
          className="block h-1 w-10 rounded-full bg-accent-glow"
        />
        <div className="space-y-1">
          <h1 className="text-4xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>

      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}
