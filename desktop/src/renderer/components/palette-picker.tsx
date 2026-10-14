import { Check } from "lucide-react";
import React, { useEffect, useState } from "react";

import {
  applyPalette,
  getStoredPalette,
  setPalette,
} from "@/renderer/helpers/theme/theme-helper";
import { cn } from "@/renderer/lib/utils";
import { COLOR_PALETTES, COLOR_PALETTE_IDS, type ColorPaletteId } from "@/shared/types/theme";

/**
 * Palette chooser.
 *
 * Rendered as a grid of swatch cards rather than a dropdown: colour choice is a
 * visual decision, and a preview of the actual hues is far more useful than a
 * list of names. Each swatch is a small mock of the palette — background, accent
 * and highlight — drawn from static CSS values so the preview does not depend on
 * the palette being active.
 */
interface PalettePickerProps {
  className?: string;
}

function PaletteSwatch({ colors, className }: { colors: readonly string[]; className?: string }) {
  return (
    <span className={cn("flex overflow-hidden rounded-md ring-1 ring-inset", className)}>
      {colors.map((color, index) => (
        <span
          key={`${color}-${index}`}
          className="h-full flex-1"
          style={{ backgroundColor: color }}
        />
      ))}
    </span>
  );
}

export function PalettePicker({ className }: PalettePickerProps) {
  const [palette, setPaletteState] = useState<ColorPaletteId>("default");

  useEffect(() => {
    // Read the stored value on mount. The document attribute is already set by
    // `applyStoredThemeClass`, so this only syncs the control's own state.
    setPaletteState(getStoredPalette());
  }, []);

  const choose = (next: ColorPaletteId) => {
    setPalette(next);
    setPaletteState(next);
  };

  // Re-apply on mount so a palette stored in a previous session is guaranteed to
  // be on the element even if something reset the attribute.
  useEffect(() => {
    applyPalette(getStoredPalette());
  }, []);

  return (
    <div
      role="radiogroup"
      aria-label="Colour palette"
      className={cn("grid grid-cols-2 gap-2 sm:grid-cols-4", className)}
    >
      {COLOR_PALETTE_IDS.map((id) => {
        const definition = COLOR_PALETTES[id];
        const selected = palette === id;

        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => {
              choose(id);
            }}
            title={definition.description}
            className={cn(
              "group relative flex flex-col gap-2 rounded-lg border p-2.5 text-left transition-colors",
              "hover:border-accent-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected ? "border-accent-glow bg-accent-soft/40" : "border-border bg-transparent"
            )}
          >
            <PaletteSwatch colors={definition.swatch} className="h-7 w-full" />

            <span className="flex items-center gap-1.5">
              <span className="truncate text-xs font-medium">{definition.label}</span>
              {selected ? <Check className="h-3 w-3 shrink-0 text-accent-glow" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
