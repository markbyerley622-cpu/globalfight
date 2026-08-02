"use client";

// ════════════════════════════════════════════════════════════════════════
//  The sign-up consent dialog.
//
//  WHY IT IS GENERATED, NOT WRITTEN. The summary a user reads at the moment
//  they consent is the ONE piece of legal text that must be true — it is the
//  basis on which they agreed. A hand-written blurb here would be a second copy
//  of the privacy notice, and second copies drift: someone adds a processor,
//  updates /privacy, and the sign-up box keeps promising the old, smaller set.
//
//  So this renders from DATA_CATEGORIES and PROCESSORS — the same source the
//  /privacy page renders from. Add a processor to the inventory and it appears
//  here automatically. Forget to add it and BOTH are wrong together, which is a
//  bug you can find, rather than a silent disagreement between two documents.
//
//  This is a SUMMARY and says so, linking to the full notice. A summary that
//  pretends to be the whole policy is worse than no summary.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from "react";
import Link from "next/link";
import { X, ExternalLink } from "lucide-react";
import { DATA_CATEGORIES, activeProcessors } from "@/lib/privacy-inventory";
import { Button } from "@/components/ui/button";

export type ConsentTopic = "privacy" | "terms";

// The handful of promises that actually bind us, stated plainly. Each one is
// enforced by code elsewhere; the comment names where, so a reviewer can check.
const TERMS_POINTS: Array<{ title: string; body: string }> = [
  {
    title: "No money, no gambling",
    body:
      "Predictions score points only. You never stake, deposit or win money, and we are not a bookmaker. Odds shown next to a bout are published for information and are not an offer to bet.",
  },
  {
    title: "You own what you write",
    body:
      "Your posts, messages and predictions stay yours. You give us permission to display them on the service so the site can function — nothing more. Delete your account and what you wrote goes with it.",
  },
  {
    title: "Fighter records come from public sources",
    body:
      "Results, cards and records are compiled from published sources and can be wrong or incomplete. We show you where each one came from. Do not rely on them for anything that matters — a commission, a contract, or a wager.",
  },
  {
    title: "Behave, or lose the account",
    body:
      "Harassment, impersonation, and posting other people's private information end the account. Claiming a fighter profile that is not yours ends it too.",
  },
  {
    title: "You must be old enough",
    body: "There is a minimum age for an account and you are confirming you meet it.",
  },
];

export function ConsentDialog({
  topic,
  onClose,
}: {
  topic: ConsentTopic;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes, focus starts inside the dialog, and focus is TRAPPED — a
  // modal you can tab out of leaves a keyboard user typing into a form they
  // cannot see, which is the accessibility failure this pattern is famous for.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    // The page behind must not scroll while the dialog is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const isPrivacy = topic === "privacy";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-dialog-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-ink-700 bg-ink-900 shadow-2xl sm:max-h-[85dvh] sm:rounded-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-ink-700 px-5 py-4">
          <div>
            <h2 id="consent-dialog-title" className="text-lg font-semibold text-white">
              {isPrivacy ? "How we handle your data" : "The agreement, in short"}
            </h2>
            <p className="mt-1 text-xs text-fog">
              A summary — the {isPrivacy ? "full notice" : "full terms"} govern.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2 text-fog transition-colors hover:bg-ink-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm leading-relaxed text-mist">
          {isPrivacy ? <PrivacySummary /> : <TermsSummary />}
        </div>

        <footer className="flex shrink-0 flex-col gap-3 border-t border-ink-700 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href={isPrivacy ? "/privacy" : "/terms"}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-blood-400 underline underline-offset-2 hover:text-blood-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
          >
            Read the full {isPrivacy ? "privacy notice" : "terms"}
            <ExternalLink className="size-3.5" />
          </Link>
          <Button type="button" onClick={onClose} className="w-full sm:w-auto">
            Close
          </Button>
        </footer>
      </div>
    </div>
  );
}

function PrivacySummary() {
  const processors = activeProcessors();
  return (
    <div className="space-y-5">
      <p className="text-white">
        We keep what the site needs to work, and we say where all of it goes. We do not sell your
        data, we run no advertising, and there is no third-party tracking script on this site.
      </p>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fog">
          What we hold, and why
        </h3>
        <ul className="space-y-3">
          {DATA_CATEGORIES.map((c) => (
            <li key={c.category} className="border-l-2 border-ink-700 pl-3">
              <p className="font-medium text-white">{c.category}</p>
              <p className="mt-0.5 text-xs text-mist">{c.data}</p>
              <p className="mt-1 text-xs text-fog">
                <span className="text-mist">Basis:</span> {c.lawfulBasis}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fog">
          Who else receives it
        </h3>
        <ul className="space-y-2">
          {processors.map((p) => (
            <li key={p.name} className="text-xs">
              <span className="font-medium text-white">{p.name}</span>
              <span className="text-fog"> — {p.role}. </span>
              <span className="text-mist">{p.dataSent}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-fog">
          Features that are switched off send nothing at all; the full notice lists those too.
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fog">Your rights</h3>
        <p className="text-xs">
          You can see your data, correct it, export it, or delete it. Account deletion is immediate
          and permanent — we do not keep a shadow copy. You can also object to processing based on
          legitimate interests, and complain to your data-protection regulator.
        </p>
      </section>
    </div>
  );
}

function TermsSummary() {
  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {TERMS_POINTS.map((p) => (
          <li key={p.title} className="border-l-2 border-ink-700 pl-3">
            <p className="font-medium text-white">{p.title}</p>
            <p className="mt-0.5 text-xs text-mist">{p.body}</p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-fog">
        The service is provided as-is. We do our best to keep the data accurate and we correct
        mistakes when we find them, but we cannot promise it is complete.
      </p>
    </div>
  );
}
