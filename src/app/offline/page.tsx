import { WifiOff } from "lucide-react";

export const metadata = { title: "Offline" };

// Precached fallback the service worker serves when a navigation fails offline.
export default function OfflinePage() {
  return (
    <div className="container-cr flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <WifiOff className="size-10 text-fog" />
      <h1 className="font-display text-2xl font-black text-chalk">You&apos;re offline</h1>
      <p className="max-w-xs text-sm text-fog">
        Check your connection — the latest fights, your picks and the crowd read will load again once you&apos;re back.
      </p>
    </div>
  );
}
