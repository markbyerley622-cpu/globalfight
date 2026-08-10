import Link from "next/link";
import { ShieldOff } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { listBlocked } from "@/lib/blocks/repo";
import { BlockButton } from "@/components/block-button";

/**
 * The people you have blocked, and the way back.
 *
 * ── Why the list exists at all ───────────────────────────────────────────
 * Blocking from a profile is reachable; UNBLOCKING from a profile is not, in
 * the case that matters — once someone is blocked their content is filtered out
 * of your feeds, so the profile you would go to in order to undo it is the one
 * you can no longer stumble across. Without this screen a block would be
 * effectively irreversible, which is not what the button promises.
 *
 * ── Why it shows only blocks you MADE ────────────────────────────────────
 * Blocks are stored directionally and this reads that direction only. Who has
 * blocked YOU is never shown anywhere in the product, on purpose — see
 * lib/blocks/repo.
 *
 * Renders nothing when the list is empty. An "0 blocked people" panel on every
 * settings screen is a permanent reminder of a feature almost nobody uses.
 */
export async function BlockedList() {
  const me = await getCurrentUser();
  if (!me) return null;

  const blocked = await listBlocked(me.id);
  if (blocked.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-chalk">
        <ShieldOff aria-hidden className="size-4 text-fog" /> Blocked people
      </h2>
      <p className="mt-1 text-2xs text-fog">
        You and they cannot message or follow each other, and their posts are hidden from you.
        They are not told. Unblocking does not restore any follow that existed before.
      </p>

      <ul className="mt-3 overflow-hidden card-surface">
        {blocked.map((p) => (
          <li key={p.id} className="flex items-center gap-3 border-b border-ink-800 px-4 py-3 last:border-b-0">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-chalk">{p.name}</span>
              {p.username && (
                <Link
                  href={`/u/${p.username}`}
                  className="block truncate text-2xs text-fog transition-colors hover:text-mist"
                >
                  @{p.username}
                </Link>
              )}
            </span>
            {/* The same component as the profile button, mounted in its blocked
                state — so "Blocked → Unblock" behaves identically wherever it is
                pressed. Guarded on `username` because the endpoint is keyed by
                handle; an account without one was never blockable in the first
                place, and rendering a button that cannot work is worse than
                rendering none. */}
            {p.username && (
              <BlockButton username={p.username} name={p.name} initialBlocked />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
