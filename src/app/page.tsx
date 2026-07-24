import { redirect } from "next/navigation";

// The events app IS the home. The old "/" timeline read as a separate, older
// page — on mobile, opening the domain landed there instead of the app. Redirect
// every entry (browser, installed PWA, typed URL, shared link) to /events,
// carrying a sport filter through if one was on the URL.
export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ sport?: string }> }) {
  const { sport } = await searchParams;
  redirect(sport ? `/events?sport=${encodeURIComponent(sport)}` : "/events");
}
