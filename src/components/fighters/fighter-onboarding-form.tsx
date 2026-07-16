"use client";

import { useState } from "react";
import { Loader2, AlertCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterSelect } from "@/components/ui/filter-select";
import { SPORTS } from "@/lib/sports";

type Form = Record<string, string>;

export function FighterOnboardingForm({
  defaultName, onSaved,
}: {
  defaultName?: string;
  onSaved: (slug: string) => void;
}) {
  const [f, setF] = useState<Form>({
    name: defaultName ?? "", sport: "MMA", nationality: "", countryCode: "", residence: "",
    nickname: "", gym: "", promotion: "", website: "", instagram: "", bio: "",
    wins: "", losses: "", draws: "", noContests: "",
    beltRank: "", style: "", federation: "", rank: "",
  });
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const recordType = SPORTS.find((s) => s.value === f.sport)?.recordType ?? "wld";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/fighters/onboard", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...f, active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save profile.");
      onSaved(data.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-blood-500/40 bg-blood-500/10 p-3 text-sm text-blood-200">
          <AlertCircle className="mt-0.5 size-4 shrink-0" /> <span>{error}</span>
        </div>
      )}

      <Field label="Fighter name *" value={f.name} onChange={set("name")} placeholder="Ring / cage name" />

      <div>
        <Label>Sport *</Label>
        <FilterSelect value={f.sport} onChange={set("sport")} options={SPORTS.map((s) => ({ value: s.value, label: s.label }))} placeholder="Select sport" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nationality *" value={f.nationality} onChange={set("nationality")} placeholder="e.g. Ireland" />
        <Field label="Country code" value={f.countryCode} onChange={set("countryCode")} placeholder="IE" />
      </div>
      <Field label="Residence *" value={f.residence} onChange={set("residence")} placeholder="City, Country" />

      <label className="flex items-center gap-2 text-sm text-mist">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-blood-500" />
        Active competitor
      </label>

      {/* Sport-specific record */}
      <div className="rounded-lg border border-ink-800 bg-ink-950/40 p-3">
        <Label>Record</Label>
        {(recordType === "wld" || recordType === "wld-nc") && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            <NumField label="Wins" value={f.wins} onChange={set("wins")} />
            <NumField label="Losses" value={f.losses} onChange={set("losses")} />
            <NumField label="Draws" value={f.draws} onChange={set("draws")} />
            {recordType === "wld-nc" && <NumField label="No Contests" value={f.noContests} onChange={set("noContests")} />}
          </div>
        )}
        {recordType === "belt" && (
          <FilterSelect value={f.beltRank} onChange={set("beltRank")} placeholder="Belt rank"
            options={["White", "Blue", "Purple", "Brown", "Black"].map((b) => ({ value: b, label: b }))} />
        )}
        {recordType === "style" && (
          <FilterSelect value={f.style} onChange={set("style")} placeholder="Wrestling style"
            options={["Freestyle", "Greco-Roman", "Folkstyle"].map((b) => ({ value: b, label: b }))} />
        )}
        {recordType === "rank" && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Rank" value={f.rank} onChange={set("rank")} placeholder="e.g. 3rd Dan" />
            {f.sport === "TAEKWONDO" && (
              <div>
                <Label>Federation</Label>
                <FilterSelect value={f.federation} onChange={set("federation")} placeholder="Federation"
                  options={[{ value: "WT", label: "World Taekwondo (WT)" }, { value: "ITF", label: "ITF" }]} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Optional */}
      <details className="rounded-lg border border-ink-800 bg-ink-950/40 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-mist">Optional details</summary>
        <div className="mt-3 space-y-3">
          <Field label="Nickname" value={f.nickname} onChange={set("nickname")} placeholder="" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Gym / Team" value={f.gym} onChange={set("gym")} placeholder="" />
            <Field label="Promotion" value={f.promotion} onChange={set("promotion")} placeholder="" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Website" value={f.website} onChange={set("website")} placeholder="https://" />
            <Field label="Instagram" value={f.instagram} onChange={set("instagram")} placeholder="@handle" />
          </div>
          <div>
            <Label>Biography</Label>
            <textarea value={f.bio} onChange={(e) => set("bio")(e.target.value)} rows={3}
              className="w-full resize-y rounded-lg border border-ink-700 bg-ink-950/50 p-3 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50" />
          </div>
        </div>
      </details>

      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> Saving…</span> : <span className="flex items-center justify-center gap-2"><Check className="size-4" /> Publish my fighter profile</span>}
      </Button>
    </form>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-fog">{children}</span>;
}
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="h-11 w-full rounded-lg border border-ink-700 bg-ink-950/50 px-3 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50" />
    </label>
  );
}
function NumField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <input type="number" min={0} value={value} onChange={(e) => onChange(e.target.value)} placeholder="0"
        className="h-11 w-full rounded-lg border border-ink-700 bg-ink-950/50 px-3 text-sm tabular-nums text-chalk outline-none placeholder:text-fog focus:border-blood-500/50" />
    </label>
  );
}
