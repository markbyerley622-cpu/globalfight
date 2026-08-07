"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Star, ThumbsUp, BadgeCheck, Check, X, Loader2, Pencil, Trash2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, timeAgo } from "@/lib/utils";
import type { GymReviewData, ReviewDTO } from "@/lib/gym-reviews";
import { ButtonLink } from "@/components/ui/button";
import { Composer } from "@/components/composer/composer";

// Presentation config kept local so this client component never imports the
// server-only review module. Order = display order.
const CATEGORY_META: { key: keyof ReviewDTO["categories"]; label: string }[] = [
  { key: "coaching", label: "Coaching" },
  { key: "facilities", label: "Facilities" },
  { key: "atmosphere", label: "Atmosphere" },
  { key: "cleanliness", label: "Cleanliness" },
  { key: "value", label: "Value" },
];
const SKILL_LEVELS = ["beginner", "intermediate", "advanced", "professional"] as const;
const ROLE_LABEL: Record<string, string> = { owner: "Owner", coach: "Coach", member: "Member" };

// ── Stars ─────────────────────────────────────────────────────────────────────

/** Read-only star row. */
function Stars({ value, size = "sm" }: { value: number; size?: "sm" | "lg" }) {
  const px = size === "lg" ? "size-5" : "size-3.5";
  return (
    <span className="inline-flex" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn(px, n <= value ? "fill-gold-400 text-gold-400" : "text-ink-600")} />
      ))}
    </span>
  );
}

/** Interactive star input. */
function StarInput({ value, onChange, label }: { value: number | null; onChange: (v: number) => void; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-24 text-2xs uppercase tracking-wide text-fog">{label}</span>
      <span className="flex">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${label} ${n} of 5`}
            aria-pressed={(value ?? 0) >= n}
            onClick={() => onChange(n)}
            className="tap p-0.5"
          >
            <Star className={cn("size-5 transition-colors", (value ?? 0) >= n ? "fill-gold-400 text-gold-400" : "text-ink-600 hover:text-ink-500")} />
          </button>
        ))}
      </span>
    </span>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function GymReviews({
  gymSlug, gymName, disciplines, data, signedIn,
}: {
  gymSlug: string;
  gymName: string;
  disciplines: string[];
  data: GymReviewData;
  signedIn: boolean;
}) {
  const [composing, setComposing] = useState(false);
  const { summary, reviews, myReview } = data;

  return (
    <div>
      {/* Summary */}
      {summary.count > 0 ? (
        <ReviewSummary summary={summary} />
      ) : (
        <p className="rounded-card border border-dashed border-ink-700 bg-ink-900/40 p-5 text-center text-sm text-fog">
          No reviews yet — be the first to tell fighters what training at {gymName} is really like.
        </p>
      )}

      {/* Compose / edit */}
      <div className="mt-4">
        {!signedIn ? (
          <ButtonLink href="/account" size="sm" className="px-4">
            Sign in to review
          </ButtonLink>
        ) : composing ? (
          <ReviewForm
            gymSlug={gymSlug}
            disciplines={disciplines}
            existing={myReview}
            onClose={() => setComposing(false)}
          />
        ) : myReview ? (
          <div>
            <p className="mb-2 font-display text-2xs font-bold uppercase tracking-wider text-fog">Your review</p>
            <ReviewCard review={myReview} gymSlug={gymSlug} onEdit={() => setComposing(true)} />
          </div>
        ) : (
          <Button size="sm" onClick={() => setComposing(true)}>
            <Pencil className="size-3.5" /> Write a review
          </Button>
        )}
      </div>

      {/* The room's reviews */}
      {reviews.length > 0 && (
        <ol className="mt-5 space-y-3">
          {reviews.map((r) => (
            <li key={r.id}><ReviewCard review={r} gymSlug={gymSlug} /></li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ReviewSummary({ summary }: { summary: GymReviewData["summary"] }) {
  return (
    <div className="grid gap-4 card-surface p-5 sm:grid-cols-[auto_1fr]">
      {/* Headline */}
      <div className="flex flex-col items-center justify-center gap-1 border-ink-800 pb-4 text-center sm:border-r sm:pb-0 sm:pr-6">
        <p className="font-display text-5xl font-black tabular-nums text-chalk">{summary.average.toFixed(1)}</p>
        <Stars value={Math.round(summary.average)} size="lg" />
        <p className="text-2xs text-fog">{summary.count} review{summary.count === 1 ? "" : "s"}</p>
        {summary.recommendedPct > 0 && (
          <p className="text-2xs font-semibold text-up">{summary.recommendedPct}% recommend</p>
        )}
        {summary.verifiedCount > 0 && (
          <p className="inline-flex items-center gap-1 text-2xs text-fog"><BadgeCheck className="size-3 text-volt-400" /> {summary.verifiedCount} verified</p>
        )}
      </div>

      {/* Distribution + category averages */}
      <div className="space-y-3">
        <div className="space-y-1">
          {summary.distribution.map((d) => {
            const pct = summary.count ? Math.round((d.count / summary.count) * 100) : 0;
            return (
              <div key={d.star} className="flex items-center gap-2 text-2xs text-fog">
                <span className="w-3 tabular-nums">{d.star}</span>
                <Star className="size-3 fill-gold-400 text-gold-400" />
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-700">
                  <span className="block h-full rounded-full bg-gold-400/70" style={{ width: `${pct}%` }} />
                </span>
                <span className="w-6 text-right tabular-nums">{d.count}</span>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-ink-800 pt-3">
          {CATEGORY_META.map(({ key, label }) => {
            const v = summary.categoryAverages[key];
            if (v == null) return null;
            return (
              <span key={key} className="inline-flex items-center gap-1.5 text-2xs">
                <span className="text-fog">{label}</span>
                <span className="inline-flex items-center gap-0.5 font-semibold text-chalk"><Star className="size-3 fill-gold-400 text-gold-400" />{v.toFixed(1)}</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ReviewCard({ review, gymSlug, onEdit }: { review: ReviewDTO; gymSlug: string; onEdit?: () => void }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [helpful, setHelpful] = useState({ count: review.helpfulCount, voted: review.votedHelpful });
  const [busy, setBusy] = useState(false);
  const long = review.body.length > 280;

  async function vote() {
    if (busy) return;
    setBusy(true);
    // Optimistic.
    const optimistic = { count: helpful.count + (helpful.voted ? -1 : 1), voted: !helpful.voted };
    setHelpful(optimistic);
    try {
      const res = await fetch(`/api/gyms/${gymSlug}/reviews/${review.id}/helpful`, { method: "POST" });
      if (res.ok) { const d = await res.json(); setHelpful({ count: d.helpfulCount, voted: d.voted }); }
      else setHelpful({ count: review.helpfulCount, voted: review.votedHelpful });
    } catch { setHelpful({ count: review.helpfulCount, voted: review.votedHelpful }); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm("Delete your review?")) return;
    setBusy(true);
    await fetch(`/api/gyms/${gymSlug}/reviews`, { method: "DELETE" });
    router.refresh();
  }

  const initial = review.authorName.slice(0, 1).toUpperCase();
  const rated = CATEGORY_META.filter((c) => review.categories[c.key] != null);

  return (
    <div className="card-surface p-4">
      <div className="flex items-start gap-3">
        {review.authorImage ? (
          <Image src={review.authorImage} alt="" width={36} height={36} unoptimized className="size-9 shrink-0 rounded-full object-cover" />
        ) : (
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-blood-500/15 font-display text-sm font-bold text-blood-300">{initial}</span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {review.authorUsername ? (
              <Link href={`/u/${review.authorUsername}`} className="truncate font-display text-sm font-bold text-chalk hover:text-blood-300">{review.authorName}</Link>
            ) : (
              <span className="truncate font-display text-sm font-bold text-chalk">{review.authorName}</span>
            )}
            {review.verifiedMember && (
              <span className="inline-flex items-center gap-0.5 rounded bg-volt-500/15 px-1.5 py-0.5 text-4xs font-bold uppercase tracking-wide text-volt-300">
                <BadgeCheck className="size-2.5" /> {review.authorRole ? ROLE_LABEL[review.authorRole] ?? "Member" : "Member"}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-fog">
            <Stars value={review.overall} />
            {review.skillLevel && <span className="capitalize">· {review.skillLevel}</span>}
            <span>· {timeAgo(new Date(review.createdAt))}{review.edited ? " · edited" : ""}</span>
          </div>
        </div>
        {/* Edit sits next to a DESTRUCTIVE control, so this row deliberately does
            NOT take `cr-touch-target`: 44px zones on a 4px gap overlap by 14px and
            the later element wins, which would route "edit" taps into "delete".
            Growing the real box (26px -> 30px) and the gap (4 -> 8) is the safe
            half of that fix. */}
        {onEdit && (
          <div className="flex shrink-0 gap-2">
            <button onClick={onEdit} className="rounded p-2 text-fog hover:text-chalk" aria-label="Edit review"><Pencil className="size-3.5" /></button>
            <button onClick={remove} disabled={busy} className="rounded p-2 text-fog hover:text-blood-400" aria-label="Delete review"><Trash2 className="size-3.5" /></button>
          </div>
        )}
      </div>

      {review.recommended && (
        <p className="mt-2 inline-flex items-center gap-1 text-2xs font-semibold text-up"><Check className="size-3.5" /> Recommends this gym</p>
      )}
      {review.title && <p className="mt-2 font-display text-sm font-bold text-chalk">{review.title}</p>}

      <div className="mt-1.5">
        <p className={cn("whitespace-pre-wrap break-words text-sm leading-relaxed text-mist", !expanded && long && "line-clamp-4")}>{review.body}</p>
        {long && (
          <button onClick={() => setExpanded((v) => !v)} className="mt-1 inline-flex items-center gap-0.5 text-2xs font-semibold text-blood-300">
            {expanded ? "Show less" : "Read more"} <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
          </button>
        )}
      </div>

      {rated.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
          {rated.map((c) => (
            <span key={c.key} className="inline-flex items-center gap-1 text-2xs text-fog">
              {c.label} <span className="inline-flex items-center gap-0.5 font-semibold text-mist"><Star className="size-2.5 fill-gold-400 text-gold-400" />{review.categories[c.key]}</span>
            </span>
          ))}
        </div>
      )}
      {review.disciplines.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {review.disciplines.map((d) => (
            <span key={d} className="rounded-md border border-ink-700 bg-ink-950/40 px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide text-fog">{d}</span>
          ))}
        </div>
      )}

      {!onEdit && (
        <div className="mt-3 border-t border-ink-800 pt-2.5">
          <button
            onClick={vote}
            disabled={busy}
            aria-pressed={helpful.voted}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors",
              helpful.voted ? "border-up/40 bg-up/10 text-up" : "border-ink-700 text-fog hover:border-ink-600 hover:text-chalk",
            )}
          >
            <ThumbsUp className="size-3.5" /> Helpful{helpful.count > 0 ? ` · ${helpful.count}` : ""}
          </button>
        </div>
      )}
    </div>
  );
}

function ReviewForm({
  gymSlug, disciplines, existing, onClose,
}: {
  gymSlug: string;
  disciplines: string[];
  existing: ReviewDTO | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [overall, setOverall] = useState<number | null>(existing?.overall ?? null);
  const [cats, setCats] = useState<Record<string, number | null>>({
    coaching: existing?.categories.coaching ?? null,
    facilities: existing?.categories.facilities ?? null,
    atmosphere: existing?.categories.atmosphere ?? null,
    cleanliness: existing?.categories.cleanliness ?? null,
    value: existing?.categories.value ?? null,
  });
  const [recommended, setRecommended] = useState(existing?.recommended ?? true);
  const [skill, setSkill] = useState<string>(existing?.skillLevel ?? "");
  const [picked, setPicked] = useState<string[]>(existing?.disciplines ?? []);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleDiscipline(d: string) {
    setPicked((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!overall) { setError("Pick an overall rating."); return; }
    if (body.trim().length < 3) { setError("Add a few words about the gym."); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/gyms/${gymSlug}/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          overall,
          coaching: cats.coaching, facilities: cats.facilities, atmosphere: cats.atmosphere,
          cleanliness: cats.cleanliness, value: cats.value,
          title: title.trim() || null,
          body: body.trim(),
          recommended,
          skillLevel: skill || null,
          disciplines: picked,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? "Could not save your review."); }
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 card-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-bold uppercase tracking-wide text-chalk">{existing ? "Edit your review" : "Write a review"}</h3>
        <button type="button" onClick={onClose} className="text-fog hover:text-chalk" aria-label="Close"><X className="size-4" /></button>
      </div>

      {error && <p className="rounded-lg border border-blood-500/40 bg-blood-500/10 px-3 py-2 text-xs text-blood-200">{error}</p>}

      {/* Overall + recommend */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StarInput label="Overall" value={overall} onChange={setOverall} />
        <div className="inline-flex overflow-hidden rounded-lg border border-ink-700">
          <button type="button" onClick={() => setRecommended(true)} className={cn("px-3 py-1.5 text-xs font-semibold", recommended ? "bg-up/15 text-up" : "text-fog")}>Recommend</button>
          <button type="button" onClick={() => setRecommended(false)} className={cn("px-3 py-1.5 text-xs font-semibold", !recommended ? "bg-blood-500/15 text-blood-300" : "text-fog")}>Wouldn&apos;t</button>
        </div>
      </div>

      {/* Category ratings */}
      <div className="grid gap-1.5">
        {CATEGORY_META.map((c) => (
          <StarInput key={c.key} label={c.label} value={cats[c.key]} onChange={(v) => setCats((s) => ({ ...s, [c.key]: v }))} />
        ))}
      </div>

      {/* Skill level */}
      <div>
        <p className="mb-1.5 text-2xs uppercase tracking-wide text-fog">Your level</p>
        <div className="flex flex-wrap gap-1.5">
          {SKILL_LEVELS.map((lvl) => (
            <button key={lvl} type="button" onClick={() => setSkill(skill === lvl ? "" : lvl)} className={cn("rounded-lg border px-2.5 py-1 text-xs font-semibold capitalize transition-colors", skill === lvl ? "border-blood-500 bg-blood-500/15 text-chalk" : "border-ink-700 text-fog hover:border-ink-600")}>
              {lvl}
            </button>
          ))}
        </div>
      </div>

      {/* Disciplines trained */}
      {disciplines.length > 0 && (
        <div>
          <p className="mb-1.5 text-2xs uppercase tracking-wide text-fog">What you train here</p>
          <div className="flex flex-wrap gap-1.5">
            {disciplines.map((d) => (
              <button key={d} type="button" onClick={() => toggleDiscipline(d)} className={cn("rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors", picked.includes(d) ? "border-volt-500 bg-volt-500/15 text-chalk" : "border-ink-700 text-fog hover:border-ink-600")}>
                {d}
              </button>
            ))}
          </div>
        </div>
      )}

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
        placeholder="Title (optional) — e.g. Elite wrestling, welcoming room"
        className="w-full rounded-lg border border-ink-700 bg-ink-950/50 px-3 py-2 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50"
      />
      {/* Document-like, and the surface where losing text would hurt most —
          a review is the longest thing most people write here. */}
      <Composer
        value={body}
        onChange={setBody}
        rows={4}
        maxLength={4000}
        showCount
        placeholder="How's the coaching, the rounds, the room? Would you send a training partner here?"
        draftKey={`gym-review:${gymSlug}`}
        className="w-full resize-y rounded-lg border border-ink-700 bg-ink-950/50 p-3 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50"
      />

      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} {existing ? "Save changes" : "Post review"}
        </Button>
      </div>
    </form>
  );
}
