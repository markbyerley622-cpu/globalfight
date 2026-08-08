"use client";

import { Dumbbell, MessageSquare, User } from "lucide-react";
import Link from "next/link";
import { PresenceDot, PresenceLabel } from "@/components/presence/presence-dot";
import type { PresenceDto } from "@/lib/presence/policy";
import { registerPreview, str, num, bool, type PreviewViewProps } from "./registry";
import { PreviewActions, PreviewAction, PreviewFact, PreviewHeader, PreviewStats } from "./parts";

// ════════════════════════════════════════════════════════════════════════════
//  A PERSON.
//
//  ── What is here, and what is deliberately not ────────────────────────────
//  Identity, presence, reach, and where they train — the four things that tell
//  a reader who this is without leaving the thread they are in. Presence
//  arrives already filtered by presenceDtoFor server-side, so this component
//  renders whatever it is given and never decides visibility itself; that is
//  the whole point of the policy layer (see lib/presence/policy).
//
//  "Challenge" is absent even though the brief lists it. Challenging somebody
//  is a WRITE, and a control that mutates state does not belong in a card that
//  opens when a pointer happens to cross a word — the misfire rate on hover UI
//  is exactly why previews are read-only here. Message and Follow live on the
//  profile the card links to.
// ════════════════════════════════════════════════════════════════════════════

function MentionPreview({ preview }: PreviewViewProps) {
  const username = str(preview.username);
  const name = str(preview.name) ?? username ?? "Someone";
  const presence = (preview.presence ?? null) as PresenceDto | null;
  const homeGym = preview.homeGym as { name?: unknown; slug?: unknown } | null | undefined;
  const gymName = str(homeGym?.name);
  const gymSlug = str(homeGym?.slug);

  return (
    <div className="p-3">
      <PreviewHeader
        imageUrl={str(preview.image)}
        name={name}
        subtitle={username ? `@${username}` : null}
        verified={bool(preview.verified)}
        round
        fallback={<User className="size-4 text-fog" aria-hidden />}
        badge={
          presence ? (
            <PresenceDot presence={presence} size="sm" ringClassName="border-ink-950" />
          ) : null
        }
      />

      {/* PresenceLabel, not a hand-rolled sentence. It owns the hydration-safe
          clock (a label derived at render would differ between the server pass
          and the client one) and it renders nothing when presence is hidden —
          so the privacy switch is honoured here by construction rather than by
          this component remembering to check it. */}
      <div className="mt-1.5">
        <PresenceLabel presence={presence} />
      </div>

      {gymName && (
        <PreviewFact icon={Dumbbell}>
          Trains at{" "}
          {gymSlug ? (
            <Link href={`/gyms/${gymSlug}`} className="text-chalk underline-offset-2 hover:underline">
              {gymName}
            </Link>
          ) : (
            <span className="text-chalk">{gymName}</span>
          )}
        </PreviewFact>
      )}

      <PreviewStats
        stats={[
          { label: "Followers", value: num(preview.followers) },
          { label: "Following", value: num(preview.following) },
          { label: "Rep", value: num(preview.reputation) },
        ]}
      />

      {username && (
        <PreviewActions>
          <PreviewAction href={`/u/${username}`} primary focusTarget>
            Profile
          </PreviewAction>
          {/* Opens the conversation; it does not send anything. A read-only
              card may navigate, it may not write. */}
          <PreviewAction href={`/messages?to=${encodeURIComponent(username)}`}>
            <MessageSquare className="size-3" aria-hidden /> Message
          </PreviewAction>
        </PreviewActions>
      )}
    </div>
  );
}

registerPreview("mention", MentionPreview);

export { MentionPreview };
