"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics-client";

/** Fires one home_view event with whether the viewer got the personalized layout,
 *  so we can measure whether personalization lifts session depth / prediction rate. */
export function HomeViewTracker({ personalized }: { personalized: boolean }) {
  useEffect(() => {
    track("home_view", { personalized });
  }, [personalized]);
  return null;
}
