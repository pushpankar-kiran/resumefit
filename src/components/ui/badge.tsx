import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0", {
  variants: {
    variant: {
      default: "border-transparent bg-primary text-primary-foreground",
      secondary: "border-transparent bg-secondary text-secondary-foreground",
      outline: "text-foreground",
      good: "border-[hsl(var(--good)/0.45)] bg-[hsl(var(--good)/0.12)] text-foreground",
      warn: "border-[hsl(var(--warn)/0.7)] bg-[hsl(var(--warn)/0.16)] text-foreground",
      bad: "border-[hsl(var(--bad)/0.45)] bg-[hsl(var(--bad)/0.12)] text-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
