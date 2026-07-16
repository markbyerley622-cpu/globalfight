import type { MetadataRoute } from "next";

// PWA manifest — makes Combat Register installable to the home screen so the
// reels feed opens full-screen (standalone), which the reels overlay already
// detects and adapts to.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Combat Register",
    short_name: "Combat",
    description: "Today's best fights across every discipline — an endless combat-sports reel.",
    start_url: "/",
    display: "standalone",
    background_color: "#05070a",
    theme_color: "#05070a",
    orientation: "portrait",
    icons: [
      { src: "/cr-logo.png", sizes: "any", type: "image/png", purpose: "any" },
      { src: "/cr-logo.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
