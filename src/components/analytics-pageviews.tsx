"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/analytics-client";

/** Logs a first-party pageview on every route change. Mounted once in the shell. */
export function AnalyticsPageviews() {
  const pathname = usePathname();
  useEffect(() => {
    track("pageview", undefined, pathname);
  }, [pathname]);
  return null;
}
