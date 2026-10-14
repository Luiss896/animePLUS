import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/renderer/lib/utils";

/**
 * Surface primitive.
 *
 * Card styling used to be duplicated as a literal
 * `rounded-xl border border-border p-5` in ~20 places, which meant every visual
 * tweak had to be repeated and inevitably drifted. This centralises the surface,
 * so the theme work has a single place to act on.
 *
 * The `interactive` variant is what gives the app its hover life; it pairs a
 * raised border with a subtle lift. Lift/colour transitions are driven by the
 * theme tokens in `styles/global.css`, so they follow the selected palette
 * instead of being hardcoded per component.
 */
const cardVariants = cva("rounded-xl border border-border bg-card text-card-foreground", {
  variants: {
    variant: {
      default: "",
      /** Outlined-only surface; no background fill. */
      outline: "bg-transparent",
      /** Quiet surface for nested/secondary content. */
      muted: "bg-muted/40",
    },
    padding: {
      none: "",
      sm: "p-4",
      default: "p-5",
      lg: "p-6",
    },
    interactive: {
      true: "oa-interactive-card",
      false: "",
    },
  },
  defaultVariants: {
    variant: "default",
    padding: "default",
    interactive: false,
  },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {
  /**
   * Semantic element to render. Defaults to `div`; page blocks use `section` so
   * the document outline stays meaningful. Typed loosely on purpose — a fully
   * polymorphic ref type is not worth the complexity here, and `div` attributes
   * are valid on every element this accepts.
   */
  as?: "div" | "section" | "article" | "li";
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, padding, interactive, as: As = "div", ...props }, ref) => {
    const Comp = As as React.ElementType;
    return (
      <Comp
        ref={ref}
        className={cn(cardVariants({ variant, padding, interactive }), className)}
        {...props}
      />
    );
  }
);
Card.displayName = "Card";

/**
 * Card heading block. Kept separate from `Card` so headers can sit outside the
 * padded body (e.g. full-bleed media cards).
 */
const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2
      ref={ref}
      className={cn("text-sm font-medium leading-none tracking-tight", className)}
      {...props}
    />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("", className)} {...props} />
);
CardContent.displayName = "CardContent";

export { Card, CardContent, CardDescription, CardHeader, CardTitle, cardVariants };
