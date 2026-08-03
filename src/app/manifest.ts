import type { MetadataRoute } from "next";

// PWA manifest — makes Combat Reviews installable to the home screen so the
// reels feed opens full-screen (standalone), which the reels overlay already
// detects and adapts to.
export default function manifest(): MetadataRoute.Manifest {
  return {
    // The canonical product name. This is what a person sees under the icon on
    // their home screen forever after they install, so it is not the place to
    // leave the old working title.
    name: "Combat Reviews",
    short_name: "Combat Reviews",
    description: "Today's best fights across every discipline — an endless combat-sports reel.",
    // Launch straight into the events app (the event-centric home), never the
    // marketing "/" landing — that's the surface returning users expect.
    start_url: "/events",
    display: "standalone",
    background_color: "#05070a",
    theme_color: "#05070a",
    orientation: "portrait",
    // cr-logo.png is 507x350 and transparent. It was declared here as a 512x512
    // maskable icon, which is two separate lies: the size is wrong, and Android
    // crops maskable icons to a circle/squircle — an edge-to-edge wordmark loses
    // its sides. The maskable variants below are pre-padded into the central 80%
    // safe zone; the `any` variants keep the logo large for launchers that don't
    // mask. Both are square and sit on the app's ink background.
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Long-press the installed icon (Android) or right-click the taskbar entry
    // (desktop) to jump straight to one of these. Four is the practical ceiling —
    // Android shows at most four and silently drops the rest.
    //
    // These deliberately point at the RETURNING-user surfaces, not the marketing
    // pages: someone who has installed the app to their home screen has already
    // decided, and what they want is tonight's card or their own record.
    //
    // No `icons` on the shortcuts: an entry without one falls back to the app
    // icon, which is correct, whereas declaring a file that does not exist makes
    // the shortcut render blank.
    shortcuts: [
      { name: "Tonight's fights", short_name: "Tonight", url: "/today", description: "Today's card and your picks" },
      { name: "Schedule", short_name: "Schedule", url: "/schedule", description: "Every upcoming event" },
      { name: "Rankings", short_name: "Rankings", url: "/rankings", description: "Divisional and pound-for-pound rankings" },
      { name: "My profile", short_name: "Profile", url: "/profile", description: "Your record and predictions" },
    ],
  };
}
