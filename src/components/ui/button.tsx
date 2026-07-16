import * as React from "react";
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-display font-semibold uppercase tracking-wide transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blood-500/60 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-blood-500 text-white hover:bg-blood-400 shadow-[0_8px_30px_-12px_rgba(225,29,42,0.8)]",
        gold: "bg-gold-500 text-ink-950 hover:bg-gold-400",
        outline:
          "border border-ink-600 bg-ink-800/40 text-chalk hover:border-blood-500/60 hover:bg-ink-700/60",
        ghost: "text-mist hover:text-chalk hover:bg-ink-800",
      },
      size: {
        sm: "h-9 px-3 text-xs",
        md: "h-11 px-5 text-sm",
        lg: "h-13 px-7 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type Common = VariantProps<typeof buttonVariants> & { className?: string };

export function Button({
  className, variant, size, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & Common) {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}

export function ButtonLink({
  className, variant, size, href, ...props
}: React.ComponentProps<typeof Link> & Common) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}

export { buttonVariants };
