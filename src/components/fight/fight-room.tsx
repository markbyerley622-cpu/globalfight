"use client";
import { ButtonLink } from "@/components/ui/button";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, MessagesSquare, Swords } from "lucide-react";
import { ThreadDiscussion } from "@/components/forums/thread-discussion";
import { BattleBanner } from "@/components/fight/battle-banner";
import { ChallengeFriend } from "@/components/fight/challenge-friend";
import { useAuth } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import type { FightRoomDTO, RoomIdentity } from "@/lib/community/room-types";

type Layer = "battle" | "community";

/**
 * A fight's arena — the two conversation layers, in one place.
 *
 *   Layer 1  Rival      private, you and one opponent
 *   Layer 2  Everyone   public, spectators, analysis, memes
 *
 * ── Why the tabs are named after PEOPLE, not actions ───────────────────────
 * These read "Challenge" and "Community", and that was the whole reason the
 * challenge flow was confusing. There were three things wearing the word
 * challenge, at three different levels of the hierarchy:
 *
 *   "Challenge a friend"  an ACTION      (a button, under the pick control)
 *   "Challenge"           a PLACE        (this tab — a conversation)
 *   "Community"           another PLACE  (the other tab)
 *
 * So one of the two tabs was named like a verb and the other like a noun, and
 * the actual verb lived on a different surface entirely. A reader who wanted to
 * challenge somebody tapped the tab called Challenge — reasonably — and arrived
 * at an empty conversation whose only offer was a link to the OTHER tab.
 *
 * Both tabs are now nouns describing WHO IS IN THE ROOM, which is the one thing
 * that actually distinguishes them, and the verb has been moved to the single
 * place where somebody wants it: the rival layer, when there is no rival in it.
 * Same two layers, same components — the labels and the placement of one button.
 *
 * Mounted only when the reader opens the bout, so ONE room is loaded at a time
 * and the event page renders no discussion queries at all. Both layers are the
 * same ThreadDiscussion — scoped and gated, never duplicated.
 */
export function FightRoom({ fightSlug }: { fightSlug: string }) {
  const { user } = useAuth();
  const [room, setRoom] = useState<FightRoomDTO | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [layer, setLayer] = useState<Layer | null>(null);
  const [challenging, setChallenging] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/fights/${encodeURIComponent(fightSlug)}/room`, { method: "POST" });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as FightRoomDTO;
      setRoom(data);
      setStatus("ready");
      // Land where the argument is: your battle if you have one, else the crowd.
      setLayer((cur) => cur ?? (data.battle?.thread ? "battle" : "community"));
    } catch {
      setStatus("error");
    }
  }, [fightSlug]);

  useEffect(() => { load(); }, [load]);

  async function challenge(userId: string, name: string) {
    setChallenging(userId);
    setNotice(null);
    try {
      const res = await fetch(`/api/fights/${encodeURIComponent(fightSlug)}/challenge`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) { setNotice(data.error ?? "Could not start that battle."); return; }
      setNotice(`You're on — ${name} is your rival on this bout.`);
      setLayer("battle");
      await load();
    } catch {
      setNotice("Could not start that battle.");
    } finally {
      setChallenging(null);
    }
  }

  if (status === "loading") {
    return <div className="flex items-center justify-center gap-2 py-8 text-sm text-fog"><Loader2 className="size-4 animate-spin" /> Opening the room…</div>;
  }
  if (status === "error" || !room) {
    return (
      <div className="flex flex-col items-center gap-2 card-surface p-5 text-center">
        <MessagesSquare className="size-6 text-fog" />
        <p className="text-sm text-mist">This room is unavailable right now — try again shortly.</p>
      </div>
    );
  }

  const battle = room.battle;
  const active = layer ?? "community";

  return (
    <div className="mt-3">
      {/* Two layers, one control. There is never a question of where to talk. */}
      <div className="mb-3 flex items-center gap-1 rounded-lg border border-ink-700 bg-ink-900/60 p-1">
        <LayerTab
          active={active === "battle"}
          onClick={() => setLayer("battle")}
          icon={<Swords className="size-3.5" />}
          label="Rival"
          hint={battle?.opponent ? `vs ${battle.opponent.name.split(" ")[0]}` : battle ? "invite sent" : "none yet"}
        />
        <LayerTab
          active={active === "community"}
          onClick={() => setLayer("community")}
          icon={<MessagesSquare className="size-3.5" />}
          label="Everyone"
          hint={room.community.replyCount ? `${room.community.replyCount}` : undefined}
        />
      </div>

      {notice && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-blood-500/30 bg-blood-500/10 p-2.5 text-xs text-blood-200">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {notice}
        </p>
      )}

      {active === "battle" ? (
        <BattleLayer
          room={room}
          fightSlug={fightSlug}
          viewerId={user?.id}
          onGoToCommunity={() => setLayer("community")}
          onChallengeSent={load}
        />
      ) : (
        <ThreadDiscussion
          threadSlug={room.community.slug}
          locked={room.community.locked}
          categorySlug={room.community.categorySlug}
          identities={room.speakers}
          myCorner={room.myCorner}
          onChallenge={room.locked || challenging ? undefined : challenge}
          compact
          placeholder="Break the fight down… or start something."
          emptyLabel="Nobody has spoken on this bout yet. Go first."
        />
      )}
    </div>
  );
}

function LayerTab({ active, onClick, icon, label, hint }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        // 4px — concentric with the p-1 track that holds these tabs.
        "tap flex flex-1 items-center justify-center gap-1.5 rounded-sm px-3 py-2 text-xs font-semibold transition-colors",
        active ? "bg-blood-500/15 text-chalk ring-1 ring-blood-500/40" : "text-fog hover:text-mist",
      )}
    >
      {icon} {label}
      {hint && <span className="truncate text-3xs font-normal text-fog">· {hint}</span>}
    </button>
  );
}

/** Layer 1 — private, focused, fast. Everything else is a route into it. */
function BattleLayer({ room, fightSlug, viewerId, onGoToCommunity, onChallengeSent }: {
  room: FightRoomDTO;
  fightSlug: string;
  viewerId?: string;
  onGoToCommunity: () => void;
  onChallengeSent: () => void;
}) {
  const battle = room.battle;

  if (!viewerId) {
    return (
      <Empty>
        <p className="text-sm text-mist">Battles are one-on-one. Sign in, call the fight, and you get a rival.</p>
        <ButtonLink href="/account" size="sm" className="px-4">Sign in</ButtonLink>
      </Empty>
    );
  }
  if (!battle) {
    return (
      <Empty>
        <Swords className="size-6 text-fog" />
        {/* THE ACTION IS HERE NOW.
            This is the screen a reader reaches by tapping the tab about having a
            rival, while not having one — so it is the exact moment the "pick a
            person" control is wanted, and it used to offer only a link to the
            other tab. Two routes, ordered: name someone you know, or go and find
            someone already arguing the other corner.

            Only once a corner is called: challengeUser refuses a challenge from
            anyone without a call on the bout, so offering the button before the
            pick would be a control whose only outcome is an error. */}
        {room.myCorner ? (
          <>
            <p className="text-sm text-mist">No rival on this bout yet. Pick one.</p>
            <div className="w-full max-w-xs">
              <ChallengeFriend
                fightSlug={fightSlug}
                tone="solid"
                label="Challenge someone"
                onSent={onChallengeSent}
              />
            </div>
            <button onClick={onGoToCommunity} className="tap min-h-9 text-xs font-semibold text-blood-300 hover:underline">
              or find someone who disagrees →
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-mist">Pick a corner above — that call is what opens a battle.</p>
            <button onClick={onGoToCommunity} className="tap min-h-9 text-xs font-semibold text-blood-300 hover:underline">
              See what everyone else is saying →
            </button>
          </>
        )}
      </Empty>
    );
  }

  const theirFighter = room.myCorner === "RED" ? room.blueName : room.redName;
  const identities: Record<string, RoomIdentity> = { [battle.you.userId]: battle.you };
  if (battle.opponent) identities[battle.opponent.userId] = battle.opponent;

  return (
    <div>
      <BattleBanner battle={battle} fightDate={room.fightDate} />
      {battle.thread ? (
        <div className="mt-3">
          <ThreadDiscussion
            threadSlug={battle.thread.slug}
            locked={battle.thread.locked}
            identities={identities}
            compact
            placeholder="Say it to their face."
            emptyLabel="Nobody has spoken yet. Open it."
          />
        </div>
      ) : (
        <div className="mt-3">
          <Empty>
            <p className="text-sm text-mist">
              You&apos;re holding {room.myCorner === "RED" ? room.redName : room.blueName}. The first person to take {theirFighter} becomes your challenger.
            </p>
            {/* An open invite is still a wait. Naming somebody is the way to
                stop waiting, so the control belongs here too rather than only
                on the screen before this one. */}
            <div className="w-full max-w-xs">
              <ChallengeFriend
                fightSlug={fightSlug}
                label="Name your rival"
                onSent={onChallengeSent}
              />
            </div>
            <button onClick={onGoToCommunity} className="tap min-h-9 text-xs font-semibold text-blood-300 hover:underline">
              Meanwhile, take it to the crowd →
            </button>
          </Empty>
        </div>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col items-center gap-2.5 rounded-card border border-ink-700 bg-ink-900/60 p-6 text-center">{children}</div>;
}
