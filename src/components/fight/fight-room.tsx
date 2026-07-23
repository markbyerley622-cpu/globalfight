"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Loader2, MessagesSquare, Swords } from "lucide-react";
import { ThreadDiscussion } from "@/components/forums/thread-discussion";
import { BattleBanner } from "@/components/fight/battle-banner";
import { useAuth } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import type { FightRoomDTO, RoomIdentity } from "@/lib/community/room-types";

type Layer = "battle" | "community";

/**
 * A fight's arena — the two conversation layers, in one place.
 *
 *   Layer 1  Battle Room     private, you and your rival, where rivalry grows
 *   Layer 2  Community        public, spectators, analysis, memes
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
      <div className="flex flex-col items-center gap-2 rounded-xl border border-ink-700 bg-ink-900 p-5 text-center">
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
      <div className="mb-3 flex items-center gap-1 rounded-xl border border-ink-700 bg-ink-900/60 p-1">
        <LayerTab
          active={active === "battle"}
          onClick={() => setLayer("battle")}
          icon={<Swords className="size-3.5" />}
          label="Challenge"
          hint={battle?.opponent ? `vs ${battle.opponent.name.split(" ")[0]}` : battle ? "invite sent" : "invite a rival"}
        />
        <LayerTab
          active={active === "community"}
          onClick={() => setLayer("community")}
          icon={<MessagesSquare className="size-3.5" />}
          label="Community"
          hint={room.community.replyCount ? `${room.community.replyCount}` : undefined}
        />
      </div>

      {notice && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-blood-500/30 bg-blood-500/10 p-2.5 text-xs text-blood-200">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {notice}
        </p>
      )}

      {active === "battle" ? (
        <BattleLayer room={room} viewerId={user?.id} onGoToCommunity={() => setLayer("community")} />
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
        "tap flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
        active ? "bg-blood-500/15 text-chalk ring-1 ring-blood-500/40" : "text-fog hover:text-mist",
      )}
    >
      {icon} {label}
      {hint && <span className="truncate text-[0.65rem] font-normal text-fog">· {hint}</span>}
    </button>
  );
}

/** Layer 1 — private, focused, fast. Everything else is a route into it. */
function BattleLayer({ room, viewerId, onGoToCommunity }: {
  room: FightRoomDTO; viewerId?: string; onGoToCommunity: () => void;
}) {
  const battle = room.battle;

  if (!viewerId) {
    return (
      <Empty>
        <p className="text-sm text-mist">Battles are one-on-one. Sign in, call the fight, and you get a rival.</p>
        <Link href="/account" className="rounded-lg bg-blood-500 px-4 py-2 font-display text-xs font-semibold uppercase text-white hover:bg-blood-400">Sign in</Link>
      </Empty>
    );
  }
  if (!battle) {
    return (
      <Empty>
        <Swords className="size-6 text-fog" />
        <p className="text-sm text-mist">
          {room.myCorner
            ? "No rival yet on this bout."
            : "Pick a corner above — that call is what opens a battle."}
        </p>
        <button onClick={onGoToCommunity} className="text-xs font-semibold text-blood-300 hover:underline">
          Find someone who disagrees →
        </button>
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
            <button onClick={onGoToCommunity} className="text-xs font-semibold text-blood-300 hover:underline">
              Meanwhile, take it to the crowd →
            </button>
          </Empty>
        </div>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col items-center gap-2.5 rounded-xl border border-ink-700 bg-ink-900/60 p-6 text-center">{children}</div>;
}
