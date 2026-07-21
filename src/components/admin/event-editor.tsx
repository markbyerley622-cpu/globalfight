"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, CloudOff, ExternalLink, History, Loader2 } from "lucide-react";
import { Row, Text, Area, Select, DateTime, Section } from "@/components/admin/fields";
import { useAutosave } from "@/components/admin/use-autosave";
import { AuditDrawer } from "@/components/admin/audit-drawer";
import { SPORTS } from "@/lib/sports";
import { cn } from "@/lib/utils";

export interface EditableEvent {
  id: string; slug: string; name: string; sport: string; status: string;
  promotion: string | null; venue: string | null; city: string | null; country: string | null;
  countryCode: string | null; broadcaster: string | null;
  posterUrl: string | null; heroUrl: string | null; description: string | null;
  timezone: string | null; eventUrl: string | null; ticketUrl: string | null;
  date: string;
  broadcastStartAt: string | null; prelimStartAt: string | null; mainCardStartAt: string | null;
  lockedFields: string[]; updatedAt: string;
  boutCount: number;
}

const STATUSES = ["DRAFT", "ANNOUNCED", "SCHEDULED", "LIVE", "COMPLETED", "CANCELLED", "POSTPONED"]
  .map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }));

export function EventEditor({ initial, card }: { initial: EditableEvent; card: React.ReactNode }) {
  const [v, setV] = useState(initial);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [locks, setLocks] = useState<string[]>(initial.lockedFields);

  const save = useAutosave<EditableEvent>({
    endpoint: `/api/admin/events/${initial.id}`,
    initialUpdatedAt: initial.updatedAt,
    initialLocked: initial.lockedFields,
    onSaved: setLocks,
  });

  /** Release a field back to the importers. Locking is one-way without this:
   *  one mistaken edit would freeze a column forever. */
  async function unlock(field: string) {
    const res = await fetch(`/api/admin/events/${initial.id}/locks`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ unlock: [field] }),
    });
    if (res.ok) setLocks((await res.json()).lockedFields ?? []);
  }

  // One binder for every field: update local state optimistically so typing is
  // never blocked on the network, and queue the same change for autosave.
  function bind<K extends keyof EditableEvent>(key: K) {
    return (value: EditableEvent[K]) => {
      setV((prev) => ({ ...prev, [key]: value }));
      save.update({ [key]: value } as Partial<EditableEvent>);
    };
  }

  const held = (f: string) => locks.includes(f);
  const isDraft = v.status === "DRAFT";

  return (
    <div className="px-4 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Link href="/admin/events" className="text-xs text-fog hover:text-chalk">← Events</Link>
        <h1 className="min-w-0 truncate font-display text-lg font-bold text-chalk">{v.name}</h1>
        {isDraft && (
          <span className="rounded bg-gold-500/15 px-1.5 py-0.5 text-[0.65rem] font-bold text-gold-300">
            DRAFT · not public
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <SaveBadge state={save.state} />
          <button
            onClick={() => setHistoryOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-ink-700 px-2.5 py-1.5 text-xs font-semibold text-fog transition-colors hover:text-chalk"
          >
            <History className="size-3.5" /> History
          </button>
          {!isDraft && (
            <Link
              href={`/events/${v.slug}`}
              target="_blank"
              className="inline-flex items-center gap-1.5 rounded-md border border-ink-700 px-2.5 py-1.5 text-xs font-semibold text-fog transition-colors hover:text-chalk"
            >
              <ExternalLink className="size-3.5" /> View live
            </Link>
          )}
        </div>
      </div>

      {save.state === "conflict" && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-gold-500/50 bg-gold-500/10 px-3 py-2 text-xs text-gold-200">
          <AlertTriangle className="size-4 shrink-0" />
          Someone else saved this event while you were editing. Your changes were NOT applied.
          <button onClick={save.reload} className="ml-auto rounded bg-gold-500/20 px-2 py-1 font-semibold hover:bg-gold-500/30">
            Reload theirs
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <Section title="General">
            <Row label="Title" issue={save.issueFor("name")} locked={held("name")} onToggleLock={held("name") ? () => unlock("name") : undefined}>
              <Text value={v.name} onChange={bind("name")} onBlur={save.flush} invalid={!!save.issueFor("name")} />
            </Row>
            <Row label="Slug" hint="Changing this breaks existing links." issue={save.issueFor("slug")} locked={held("slug")} onToggleLock={held("slug") ? () => unlock("slug") : undefined}>
              <Text value={v.slug} onChange={bind("slug")} onBlur={save.flush} invalid={!!save.issueFor("slug")} mono />
            </Row>
            <Row label="Promotion" locked={held("promotion")} onToggleLock={held("promotion") ? () => unlock("promotion") : undefined}>
              <Text value={v.promotion ?? ""} onChange={(s) => bind("promotion")(s || null)} onBlur={save.flush} placeholder="e.g. ONE Championship" />
            </Row>
            <Row label="Sport" issue={save.issueFor("sport")} locked={held("sport")} onToggleLock={held("sport") ? () => unlock("sport") : undefined}>
              <Select value={v.sport} onChange={bind("sport")} options={SPORTS.map((s) => ({ value: s.value, label: s.label }))} />
            </Row>
            <Row label="Description" locked={held("description")} onToggleLock={held("description") ? () => unlock("description") : undefined}>
              <Area value={v.description ?? ""} onChange={(s) => bind("description")(s || null)} onBlur={save.flush} />
            </Row>
          </Section>

          <Section title="Location & broadcast">
            <Row label="Venue" locked={held("venue")} onToggleLock={held("venue") ? () => unlock("venue") : undefined}>
              <Text value={v.venue ?? ""} onChange={(s) => bind("venue")(s || null)} onBlur={save.flush} />
            </Row>
            <Row label="City" locked={held("city")} onToggleLock={held("city") ? () => unlock("city") : undefined}>
              <Text value={v.city ?? ""} onChange={(s) => bind("city")(s || null)} onBlur={save.flush} />
            </Row>
            <Row label="Country" locked={held("country")} onToggleLock={held("country") ? () => unlock("country") : undefined}>
              <Text value={v.country ?? ""} onChange={(s) => bind("country")(s || null)} onBlur={save.flush} />
            </Row>
            <Row label="Country code" hint="ISO-2, e.g. TH. Drives the flag." locked={held("countryCode")} onToggleLock={held("countryCode") ? () => unlock("countryCode") : undefined}>
              <Text value={v.countryCode ?? ""} onChange={(s) => bind("countryCode")(s ? s.toUpperCase().slice(0, 2) : null)} onBlur={save.flush} mono />
            </Row>
            <Row label="Broadcaster" locked={held("broadcaster")} onToggleLock={held("broadcaster") ? () => unlock("broadcaster") : undefined}>
              <Text value={v.broadcaster ?? ""} onChange={(s) => bind("broadcaster")(s || null)} onBlur={save.flush} />
            </Row>
            <Row label="Timezone" hint="IANA zone for the venue, e.g. Asia/Bangkok." locked={held("timezone")} onToggleLock={held("timezone") ? () => unlock("timezone") : undefined}>
              <Text value={v.timezone ?? ""} onChange={(s) => bind("timezone")(s || null)} onBlur={save.flush} mono />
            </Row>
          </Section>

          <Section title="Scheduling">
            <Row label="Event date" hint="First bell. Everything public counts down to this." issue={save.issueFor("date")} locked={held("date")} onToggleLock={held("date") ? () => unlock("date") : undefined}>
              <DateTime value={v.date} onChange={(iso) => iso && bind("date")(iso)} invalid={!!save.issueFor("date")} />
            </Row>
            <Row label="Broadcast start" issue={save.issueFor("broadcastStartAt")} locked={held("broadcastStartAt")} onToggleLock={held("broadcastStartAt") ? () => unlock("broadcastStartAt") : undefined}>
              <DateTime value={v.broadcastStartAt} onChange={bind("broadcastStartAt")} invalid={!!save.issueFor("broadcastStartAt")} />
            </Row>
            <Row label="Prelims start" issue={save.issueFor("prelimStartAt")} locked={held("prelimStartAt")} onToggleLock={held("prelimStartAt") ? () => unlock("prelimStartAt") : undefined}>
              <DateTime value={v.prelimStartAt} onChange={bind("prelimStartAt")} invalid={!!save.issueFor("prelimStartAt")} />
            </Row>
            <Row label="Main card start" issue={save.issueFor("mainCardStartAt")} locked={held("mainCardStartAt")} onToggleLock={held("mainCardStartAt") ? () => unlock("mainCardStartAt") : undefined}>
              <DateTime value={v.mainCardStartAt} onChange={bind("mainCardStartAt")} invalid={!!save.issueFor("mainCardStartAt")} />
            </Row>
          </Section>

          <Section title="Links & artwork">
            <Row label="Poster URL" hint="Vertical promotional poster." locked={held("posterUrl")} onToggleLock={held("posterUrl") ? () => unlock("posterUrl") : undefined}>
              <Text value={v.posterUrl ?? ""} onChange={(s) => bind("posterUrl")(s || null)} onBlur={save.flush} mono />
            </Row>
            <Row label="Hero URL" hint="16:9 artwork for the event header." locked={held("heroUrl")} onToggleLock={held("heroUrl") ? () => unlock("heroUrl") : undefined}>
              <Text value={v.heroUrl ?? ""} onChange={(s) => bind("heroUrl")(s || null)} onBlur={save.flush} mono />
            </Row>
            <Row label="Event URL" issue={save.issueFor("eventUrl")} locked={held("eventUrl")} onToggleLock={held("eventUrl") ? () => unlock("eventUrl") : undefined}>
              <Text value={v.eventUrl ?? ""} onChange={(s) => bind("eventUrl")(s || null)} onBlur={save.flush} invalid={!!save.issueFor("eventUrl")} mono />
            </Row>
            <Row label="Ticket URL" issue={save.issueFor("ticketUrl")} locked={held("ticketUrl")} onToggleLock={held("ticketUrl") ? () => unlock("ticketUrl") : undefined}>
              <Text value={v.ticketUrl ?? ""} onChange={(s) => bind("ticketUrl")(s || null)} onBlur={save.flush} invalid={!!save.issueFor("ticketUrl")} mono />
            </Row>
          </Section>

          {card}
        </div>

        <aside className="space-y-4">
          <Section title="Publishing">
            <Row label="Status" issue={save.issueFor("status")} locked={held("status")} onToggleLock={held("status") ? () => unlock("status") : undefined}>
              <Select value={v.status} onChange={bind("status")} options={STATUSES} invalid={!!save.issueFor("status")} />
            </Row>
            <div className="px-3 py-2 text-[0.7rem] leading-relaxed text-fog">
              {isDraft
                ? "Draft events are invisible everywhere — discovery, search, sitemap, feeds and calendar exports. Publishing requires exactly one main event on the card."
                : "This event is live to the public."}
            </div>
          </Section>

          <Section title="Automated updates">
            <div className="px-3 py-2.5 text-[0.7rem] leading-relaxed text-fog">
              {save.lockedFields.length === 0 ? (
                <>No fields held. Importers may update anything on this event.</>
              ) : (
                <>
                  <span className="text-mist">{save.lockedFields.length} field(s) held</span> against importers, because
                  someone edited them here. Importers still update everything else.
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {save.lockedFields.map((f) => (
                      <span key={f} className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[0.65rem] text-gold-300">{f}</span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Section>
        </aside>
      </div>

      {historyOpen && <AuditDrawer eventId={initial.id} onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}

function SaveBadge({ state }: { state: ReturnType<typeof useAutosave>["state"] }) {
  const map = {
    idle: { icon: null, label: "Up to date", cls: "text-fog" },
    dirty: { icon: null, label: "Unsaved", cls: "text-gold-300" },
    saving: { icon: <Loader2 className="size-3 animate-spin" />, label: "Saving…", cls: "text-fog" },
    saved: { icon: <Check className="size-3" />, label: "Saved", cls: "text-up" },
    error: { icon: <AlertTriangle className="size-3" />, label: "Fix errors", cls: "text-blood-300" },
    conflict: { icon: <CloudOff className="size-3" />, label: "Conflict", cls: "text-gold-300" },
  }[state];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", map.cls)}>
      {map.icon} {map.label}
    </span>
  );
}
