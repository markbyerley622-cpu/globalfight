"use client";

import { useCallback, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Loader2, Search, UserMinus, ArrowUp, ArrowDown, Crown, Users } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

export interface RosterMember {
  id: string;
  role: string;
  isHome: boolean;
  joinedAt: string;
  user: {
    id: string;
    name: string | null;
    username: string | null;
    image: string | null;
    registryRole: string;
    reputation: number;
  };
}

type Filter = "all" | "coach" | "member";

const JOINED = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" });

/**
 * The roster.
 *
 * Promote/demote/remove are optimistic and roll back — these are single-field
 * changes with one obvious thing to undo, and waiting on a round trip to see a
 * coach badge appear makes the dashboard feel broken rather than careful.
 */
export function GymMembersManager({
  slug, initial, ownerId,
}: {
  slug: string;
  initial: RosterMember[];
  ownerId: string | null;
}) {
  const [members, setMembers] = useState(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(
    async (userId: string, patch: { role?: "member" | "coach"; remove?: boolean }) => {
      const before = members;
      setBusy(userId);
      setError(null);
      setMembers((cur) =>
        patch.remove
          ? cur.filter((m) => m.user.id !== userId)
          : cur.map((m) => (m.user.id === userId ? { ...m, role: patch.role ?? m.role } : m)),
      );
      try {
        const res = await fetch(`/api/gyms/${encodeURIComponent(slug)}/members`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId, ...patch }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not update.");
      } catch (e) {
        setMembers(before);
        setError(e instanceof Error ? e.message : "Could not update.");
      } finally {
        setBusy(null);
      }
    },
    [members, slug],
  );

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return members.filter((m) => {
      if (filter === "coach" && m.role !== "coach" && m.role !== "owner") return false;
      if (filter === "member" && m.role !== "member") return false;
      if (!term) return true;
      return (
        (m.user.name ?? "").toLowerCase().includes(term) ||
        (m.user.username ?? "").toLowerCase().includes(term)
      );
    });
  }, [members, filter, q]);

  const counts = useMemo(
    () => ({
      all: members.length,
      coach: members.filter((m) => m.role === "coach" || m.role === "owner").length,
      member: members.filter((m) => m.role === "member").length,
    }),
    [members],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip size="sm" active={filter === "all"} onClick={() => setFilter("all")} count={counts.all}>All</Chip>
        <Chip size="sm" tone="neutral" active={filter === "coach"} onClick={() => setFilter("coach")} count={counts.coach}>Coaches</Chip>
        <Chip size="sm" tone="neutral" active={filter === "member"} onClick={() => setFilter("member")} count={counts.member}>Members</Chip>
      </div>

      <label className="relative flex items-center">
        <Search className="pointer-events-none absolute left-3 size-4 text-fog" />
        <span className="sr-only">Search members</span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the roster…"
          className="w-full rounded-xl border border-ink-700 bg-ink-850 py-2.5 pl-9 pr-3 text-sm text-chalk placeholder:text-fog focus:border-ink-600 focus:outline-none"
        />
      </label>

      {error && (
        <p role="alert" className="rounded-xl border border-down/40 bg-down/10 px-3.5 py-2.5 text-[0.76rem] text-down">
          {error}
        </p>
      )}

      {shown.length === 0 ? (
        <EmptyState
          compact
          icon={<Users className="size-5" />}
          title={members.length === 0 ? "Nobody has joined yet" : "No one matches"}
          body={
            members.length === 0
              ? "People appear here when they tap “I train here” on your gym page. Share the link with your members."
              : "Try a different name or filter."
          }
        />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {shown.map((m) => {
            const isOwner = m.role === "owner" || m.user.id === ownerId;
            const isCoach = m.role === "coach";
            const working = busy === m.user.id;
            return (
              <li
                key={m.id}
                className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-900/60 px-3 py-2.5"
              >
                {m.user.image ? (
                  <Image src={m.user.image} alt="" width={36} height={36} unoptimized className="size-9 shrink-0 rounded-full object-cover" />
                ) : (
                  <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-blood-500/15 font-display text-sm font-bold text-blood-300">
                    {(m.user.name ?? m.user.username ?? "?").slice(0, 1).toUpperCase()}
                  </span>
                )}

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    {m.user.username ? (
                      <Link href={`/u/${m.user.username}`} className="truncate font-display text-sm font-bold text-chalk hover:underline">
                        {m.user.name ?? m.user.username}
                      </Link>
                    ) : (
                      <span className="truncate font-display text-sm font-bold text-chalk">{m.user.name ?? "Member"}</span>
                    )}
                    {isOwner && <Crown className="size-3.5 shrink-0 text-gold-400" aria-label="Owner" />}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-[0.68rem] text-fog">
                    <span className={cn("font-semibold uppercase tracking-wide", isOwner ? "text-gold-300" : isCoach ? "text-volt-400" : "text-fog")}>
                      {isOwner ? "Owner" : isCoach ? "Coach" : "Member"}
                    </span>
                    <span>· joined {JOINED.format(new Date(m.joinedAt))}</span>
                  </span>
                </span>

                {/* The owner's own row has no controls: ownership moves through
                    a claim, and the server rejects it anyway. */}
                {!isOwner && (
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => mutate(m.user.id, { role: isCoach ? "member" : "coach" })}
                      aria-label={isCoach ? `Demote ${m.user.name ?? "member"} to member` : `Promote ${m.user.name ?? "member"} to coach`}
                      className="tap grid size-8 place-items-center rounded-lg border border-ink-700 bg-ink-850 text-mist transition-colors hover:text-chalk disabled:opacity-50"
                    >
                      {working ? <Loader2 className="size-3.5 animate-spin" /> : isCoach ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />}
                    </button>
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => {
                        if (confirm(`Remove ${m.user.name ?? "this member"} from the roster?`)) {
                          void mutate(m.user.id, { remove: true });
                        }
                      }}
                      aria-label={`Remove ${m.user.name ?? "member"} from the gym`}
                      className="tap grid size-8 place-items-center rounded-lg border border-ink-700 bg-ink-850 text-fog transition-colors hover:border-down/50 hover:text-down disabled:opacity-50"
                    >
                      <UserMinus className="size-3.5" />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[0.66rem] leading-relaxed text-fog">
        Promoting someone to coach shows them in the Coaches section of your public page. Ownership can only change
        through a reviewed claim.
      </p>
    </div>
  );
}
