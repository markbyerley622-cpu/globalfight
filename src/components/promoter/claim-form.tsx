"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, BadgeCheck, Building2, Check, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  CLAIM YOUR PROMOTION — the Google-Business-Profile shape.
//
//  Find yourself in the registry, or say you are not in it, then tell us
//  enough that a human can believe you. Two visible steps and one screen.
//
//  ── Why search comes first ────────────────────────────────────────────────
//  Most real promotions are ALREADY in the registry — they have been scraped
//  from public event listings for months. Leading with "create a promotion"
//  would have every one of them create a duplicate of a row that already has
//  their history attached, and merging those afterwards is a manual job that
//  someone has to notice needs doing.
//
//  ── Why an already-claimed org is shown, not hidden ───────────────────────
//  Hiding it makes the applicant think we do not have them and create a
//  duplicate — the exact outcome search exists to prevent. It is shown as
//  taken, with no route to apply, which answers their question honestly.
// ════════════════════════════════════════════════════════════════════════════

interface Org { id: string; name: string; verified: boolean; claimed: boolean }

export function ClaimForm() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<Org | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [fields, setFields] = useState({
    newOrgName: "", website: "", socials: "", contactEmail: "", phone: "",
    previousEvents: "", note: "",
  });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Only the newest search may write state — responses arrive out of order. */
  const seq = useRef(0);

  const run = useCallback(async (term: string) => {
    const mine = ++seq.current;
    if (!term.trim()) { setOrgs([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/promoter/claim?q=${encodeURIComponent(term)}`);
      if (mine !== seq.current) return;
      const data = res.ok ? await res.json() : null;
      setOrgs(Array.isArray(data?.orgs) ? data.orgs : []);
    } catch {
      if (mine === seq.current) setOrgs([]);
    } finally {
      if (mine === seq.current) setSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void run(q), 180);
    return () => clearTimeout(t);
  }, [q, run]);

  const set = (k: keyof typeof fields, v: string) => setFields((f) => ({ ...f, [k]: v }));

  async function submit() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/promoter/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...fields, promoterOrgId: chosen?.id ?? null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Couldn't send that application.");
        return;
      }
      setSent(true);
      // Straight to the promoter home, which now shows the pending state and
      // lets them start drafting.
      setTimeout(() => router.push("/promoter"), 1200);
    } catch {
      setError("Couldn't send that application.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-3 py-14 text-center">
        <span className="cr-pop grid size-16 place-items-center rounded-full border-2 border-volt-500/50 bg-volt-500/15 text-volt-300">
          <Check className="size-8" strokeWidth={3} aria-hidden />
        </span>
        <p className="font-display text-xl font-black uppercase tracking-tight text-chalk">
          Application sent
        </p>
        <p className="max-w-sm text-sm text-fog">
          We&apos;ll review it and let you know. You can start building drafts in the meantime.
        </p>
      </div>
    );
  }

  const ready = Boolean(chosen || fields.newOrgName.trim());

  return (
    <div className="space-y-5">
      {/* ── 1. Which promotion? ─────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="font-display text-sm font-black uppercase tracking-wider text-chalk">
          Which promotion do you run?
        </h2>

        {chosen ? (
          <div className="flex items-center gap-3 rounded-xl border border-blood-500/40 bg-blood-500/10 px-3.5 py-3">
            <Building2 className="size-5 shrink-0 text-blood-300" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-sm font-bold text-chalk">{chosen.name}</span>
              <span className="block text-xs text-fog">Claiming this promotion</span>
            </span>
            <button
              type="button"
              onClick={() => { setChosen(null); setQ(""); }}
              className="tap min-h-9 shrink-0 px-2 text-xs font-semibold text-fog hover:text-chalk"
            >
              Change
            </button>
          </div>
        ) : creatingNew ? (
          <div className="space-y-2 rounded-xl border border-ink-700 bg-ink-900/50 p-3.5">
            <Field
              label="Promotion name"
              value={fields.newOrgName}
              onChange={(v) => set("newOrgName", v)}
              placeholder="Ironforge Boxing"
            />
            <button
              type="button"
              onClick={() => { setCreatingNew(false); set("newOrgName", ""); }}
              className="tap min-h-9 text-xs font-semibold text-fog hover:text-chalk"
            >
              ← Search instead
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-950/60 px-3 focus-within:border-blood-500/60">
              <Search className="size-4 shrink-0 text-fog" aria-hidden />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                type="search"
                autoComplete="off"
                aria-label="Search promotions"
                placeholder="Search for your promotion…"
                className="h-12 flex-1 bg-transparent text-sm text-chalk outline-none placeholder:text-fog"
              />
              {searching && <Loader2 className="size-4 shrink-0 animate-spin text-fog" aria-hidden />}
            </div>

            {orgs.length > 0 && (
              <ul className="space-y-1">
                {orgs.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      disabled={o.claimed}
                      onClick={() => setChosen(o)}
                      className={cn(
                        "tap flex min-h-14 w-full items-center gap-3 rounded-lg border px-3 text-left transition-colors",
                        o.claimed
                          ? "cursor-not-allowed border-ink-800 bg-ink-900/30 opacity-60"
                          : "border-ink-800 bg-ink-900/50 hover:border-blood-500/50",
                      )}
                    >
                      <Building2 className="size-4 shrink-0 text-fog" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm text-chalk">{o.name}</span>
                      {o.verified && <BadgeCheck className="size-4 shrink-0 text-volt-400" aria-hidden />}
                      {o.claimed && (
                        <span className="shrink-0 text-3xs font-bold uppercase tracking-wider text-fog">
                          Already claimed
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              onClick={() => setCreatingNew(true)}
              className="tap min-h-11 w-full rounded-lg border border-dashed border-ink-700 text-xs font-bold uppercase tracking-wider text-fog transition-colors hover:border-blood-500/50 hover:text-mist"
            >
              {q.trim() ? `Can't find it — add "${q.trim().slice(0, 30)}"` : "My promotion isn't listed"}
            </button>
          </>
        )}
      </section>

      {/* ── 2. Prove it ─────────────────────────────────────────────────── */}
      {ready && (
        <section className="space-y-2">
          <h2 className="font-display text-sm font-black uppercase tracking-wider text-chalk">
            Help us verify you
          </h2>
          <p className="text-xs text-fog">
            Anything that shows you run this promotion. The more you give us, the faster this goes.
          </p>
          <div className="space-y-2 rounded-xl border border-ink-700 bg-ink-900/50 p-3.5">
            <Field label="Website" value={fields.website} onChange={(v) => set("website", v)} placeholder="ironforge.com" inputMode="url" />
            <Field label="Social links" value={fields.socials} onChange={(v) => set("socials", v)} placeholder="@ironforgeboxing" />
            <Field label="Contact email" value={fields.contactEmail} onChange={(v) => set("contactEmail", v)} placeholder="you@ironforge.com" inputMode="email" />
            <Field label="Phone" value={fields.phone} onChange={(v) => set("phone", v)} placeholder="Optional" inputMode="tel" />
            <Field label="Previous events" value={fields.previousEvents} onChange={(v) => set("previousEvents", v)} placeholder="Fight Night 11, Fight Night 10…" multiline />
            <Field label="Anything else" value={fields.note} onChange={(v) => set("note", v)} placeholder="Optional" multiline />
          </div>
        </section>
      )}

      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-lg border border-blood-500/40 bg-blood-500/10 px-3 py-2 text-xs text-blood-200">
          <AlertCircle className="size-4 shrink-0" aria-hidden /> {error}
        </p>
      )}

      <button
        type="button"
        disabled={!ready || sending}
        onClick={() => void submit()}
        className={cn(
          "tap flex min-h-14 w-full items-center justify-center gap-2.5 rounded-xl font-display text-sm font-black uppercase tracking-wider transition-all",
          !ready || sending
            ? "bg-ink-800 text-fog"
            : "bg-blood-500 text-white shadow-[0_12px_40px_-12px_rgba(225,29,42,0.9)] hover:bg-blood-400",
        )}
      >
        {sending ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
        Send application
      </button>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, multiline = false, inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  const shared = {
    value,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    className: "w-full rounded-lg border border-ink-700 bg-ink-950/60 px-3 py-2.5 text-sm text-chalk outline-none placeholder:text-ink-600 focus:border-blood-500/60",
  };
  return (
    <label className="block">
      <span className="mb-1 block text-3xs font-bold uppercase tracking-wider text-fog">{label}</span>
      {multiline ? <textarea {...shared} rows={2} /> : <input {...shared} type="text" inputMode={inputMode} />}
    </label>
  );
}
