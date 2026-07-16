"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ExternalLink, Pencil } from "lucide-react";
import { FighterOnboardingForm } from "@/components/fighters/fighter-onboarding-form";
import { SPORT_LABEL } from "@/lib/sports";

interface Profile { slug: string; name: string; sport: string }

/** Shown on the account dashboard for users whose role is "fighter": collects
 *  their profile (publishing them into /fighters) or links to it once live. */
export function FighterProfilePanel({ defaultName }: { defaultName?: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  async function refresh() {
    try {
      const res = await fetch("/api/fighters/onboard", { cache: "no-store" });
      const data = await res.json();
      setProfile(data.profile ?? null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  return (
    <div className="card-surface p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold uppercase text-chalk">Your fighter profile</h2>
        {profile && !editing && (
          <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-xs font-semibold text-blood-400 hover:text-blood-300">
            <Pencil className="size-3.5" /> Edit
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-fog"><Loader2 className="size-4 animate-spin" /> Loading…</div>
      ) : profile && !editing ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-up/30 bg-up/5 p-4">
            <p className="font-display font-semibold text-chalk">{profile.name}</p>
            <p className="text-sm text-mist">{SPORT_LABEL[profile.sport] ?? profile.sport} · Live in the directory</p>
          </div>
          <Link href={`/fighters/${profile.slug}`} className="flex items-center justify-center gap-2 rounded-lg bg-blood-500 px-4 py-2.5 font-display text-xs font-semibold uppercase text-white hover:bg-blood-400">
            View my public profile <ExternalLink className="size-4" />
          </Link>
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-mist">
            Publish your profile to appear in the global fighters directory. You can edit it anytime.
          </p>
          <FighterOnboardingForm defaultName={profile?.name ?? defaultName} onSaved={() => { setEditing(false); setLoading(true); refresh(); }} />
        </>
      )}
    </div>
  );
}
