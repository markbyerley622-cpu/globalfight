import type { Metadata } from "next";
import { ProfileView } from "@/components/profile/profile-view";
import { getCurrentUser } from "@/lib/auth";
import { getFollowCounts } from "@/lib/geo/people";
import { getProfileOverview } from "@/lib/profile/profile-service";
import { CurrentPicks } from "@/components/profile/current-picks";
import { RecentResults } from "@/components/profile/recent-results";

export const metadata: Metadata = {
  title: "Profile",
  description: "Your Combat Reviews profile — identity, reputation, saved clips, predictions and activity.",
  alternates: { canonical: "/profile" },
  // Your OWN dashboard, not your public identity — /u/<handle> is the page meant
  // to be indexed and shared. Without this, a signed-out crawler indexes the
  // sign-in gate under a URL that promises a profile.
  robots: { index: false, follow: false },
};

/**
 * Follower/following counts are resolved HERE, on the server, and passed down.
 *
 * They were present on /u/[username] — everyone else's profile — and absent from
 * your own, which is the one profile you look at most. The follow feature was
 * built and then invisible to its own users: you could see that a stranger had
 * followers and had no way to see whether anyone had followed you.
 *
 * Done server-side because this page already renders on the server and the
 * counts are two indexed COUNT queries; a client fetch would add a round-trip
 * and a loading state to a number that is ready before the page is sent.
 */
export default async function ProfilePage() {
  const viewer = await getCurrentUser();
  // One parallel wave, not two sequential awaits.
  const [followCounts, overview] = viewer
    ? await Promise.all([getFollowCounts(viewer.id), getProfileOverview(viewer.id)])
    : [null, null];

  return (
    <ProfileView
      followCounts={followCounts}
      username={viewer?.username ?? null}
      predictions={
        overview ? (
          <>
            <CurrentPicks picks={overview.currentPicks} more={overview.moreCurrent} isSelf />
            <RecentResults groups={overview.recentResults} more={overview.moreResults} isSelf />
          </>
        ) : null
      }
    />
  );
}
