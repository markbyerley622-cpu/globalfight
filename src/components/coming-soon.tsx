import Link from "next/link";
import { Check } from "lucide-react";

/** Lightweight "in development" section used by the new Combat product pages. */
export function ComingSoon({ points }: { points: string[] }) {
  return (
    <section className="container-cr py-12 lg:py-16">
      <div className="mx-auto max-w-2xl rounded-2xl border border-ink-800 bg-ink-900/60 p-6 sm:p-8">
        <span className="inline-flex items-center gap-2 rounded-full border border-blood-500/40 bg-blood-500/10 px-3 py-1 font-display text-xs font-semibold uppercase tracking-wide text-blood-300">
          In development
        </span>
        <h2 className="mt-4 font-display text-2xl font-bold uppercase tracking-tight text-chalk">
          Coming soon
        </h2>
        <p className="mt-2 text-sm text-mist">
          We&apos;re building this out as part of the Combat Register platform. Here&apos;s what to expect:
        </p>
        <ul className="mt-5 grid gap-3">
          {points.map((p) => (
            <li key={p} className="flex items-start gap-3 text-sm text-chalk">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-blood-500/15 text-blood-300">
                <Check className="size-3.5" />
              </span>
              {p}
            </li>
          ))}
        </ul>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            href="/account"
            className="rounded-lg bg-blood-500 px-4 py-2.5 font-display text-xs font-semibold uppercase text-white transition-colors hover:bg-blood-400"
          >
            Get early access
          </Link>
          <Link
            href="/"
            className="rounded-lg border border-ink-700 bg-ink-850/60 px-4 py-2.5 font-display text-xs font-semibold uppercase text-chalk transition-colors hover:border-ink-600"
          >
            Back to home
          </Link>
        </div>
      </div>
    </section>
  );
}
