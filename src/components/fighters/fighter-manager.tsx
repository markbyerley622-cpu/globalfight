"use client";

import { useState } from "react";
import Image from "next/image";
import { Loader2, Check, Plus, Trash2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterSelect } from "@/components/ui/filter-select";
import type { PublicProfile } from "@/lib/fighters/profile";

type ListKind = "achievement" | "sponsor" | "social" | "media";

export function FighterManager({ slug, initial }: { slug: string; initial: PublicProfile }) {
  const [achievements, setAchievements] = useState(initial.achievements);
  const [sponsors, setSponsors] = useState(initial.sponsors);
  const [socials, setSocials] = useState(initial.socials);
  const [photos, setPhotos] = useState(initial.photos);
  const [videos, setVideos] = useState(initial.videos);

  async function post(payload: Record<string, unknown>) {
    const res = await fetch(`/api/fighters/${slug}/content`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed.");
    return data;
  }
  async function del(kind: ListKind, id: string) {
    const res = await fetch(`/api/fighters/${slug}/content?kind=${kind}&id=${id}`, { method: "DELETE" });
    if (!res.ok) { const d = await res.json(); alert(d.error ?? "Failed."); return false; }
    return true;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <MetaSection slug={slug} initial={initial} post={post} />

      <ListSection
        title="Achievements"
        items={achievements.map((a) => ({ id: a.id, primary: a.title, secondary: a.year ? String(a.year) : "" }))}
        onDelete={async (id) => { if (await del("achievement", id)) setAchievements((x) => x.filter((i) => i.id !== id)); }}
        fields={[{ key: "title", placeholder: "Achievement (e.g. National Champion)" }, { key: "year", placeholder: "Year", type: "number", width: "w-24" }]}
        onAdd={async (v) => { const r = await post({ type: "achievement", title: v.title, year: v.year }); setAchievements((x) => [...x, { id: r.id, title: v.title, year: v.year ? Number(v.year) : null }]); }}
      />

      <ListSection
        title="Sponsors"
        items={sponsors.map((s) => ({ id: s.id, primary: s.name, secondary: s.url ?? "" }))}
        onDelete={async (id) => { if (await del("sponsor", id)) setSponsors((x) => x.filter((i) => i.id !== id)); }}
        fields={[{ key: "name", placeholder: "Sponsor name" }, { key: "url", placeholder: "https://" }, { key: "logoUrl", placeholder: "Logo URL (optional)" }]}
        onAdd={async (v) => { const r = await post({ type: "sponsor", name: v.name, url: v.url, logoUrl: v.logoUrl }); setSponsors((x) => [...x, { id: r.id, name: v.name, url: v.url || null, logoUrl: v.logoUrl || null }]); }}
      />

      <SocialSection slug={slug} socials={socials} setSocials={setSocials} post={post} del={del} />

      <MediaSection title="Photo gallery" mediaType="photo" items={photos} setItems={setPhotos} post={post} del={del} />
      <MediaSection title="Video gallery" mediaType="video" items={videos} setItems={setVideos} post={post} del={del} />
    </div>
  );
}

function MetaSection({ slug, initial, post }: { slug: string; initial: PublicProfile; post: (p: Record<string, unknown>) => Promise<unknown> }) {
  const [f, setF] = useState({
    tagline: initial.tagline ?? "", bio: initial.bio ?? "", contactEmail: initial.contactEmail ?? "",
    imageUrl: initial.imageUrl ?? "", heroImageUrl: initial.heroImageUrl ?? "",
    website: initial.website ?? "", instagram: initial.instagram ?? "", twitter: initial.twitter ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string) => (v: string) => { setF((p) => ({ ...p, [k]: v })); setSaved(false); };

  async function save() {
    setBusy(true); setError(null);
    try { await post({ type: "meta", ...f }); setSaved(true); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed."); }
    finally { setBusy(false); }
  }

  return (
    <div className="card-surface space-y-3 p-5 lg:col-span-2">
      <h3 className="font-display text-sm font-bold uppercase tracking-wide text-fog">Profile & website</h3>
      {error && <div className="flex items-start gap-2 rounded-lg border border-blood-500/40 bg-blood-500/10 p-2.5 text-sm text-blood-200"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Profile photo URL" value={f.imageUrl} onChange={set("imageUrl")} placeholder="https://…" />
        <Input label="Hero banner URL" value={f.heroImageUrl} onChange={set("heroImageUrl")} placeholder="https://…" />
      </div>
      {f.imageUrl && (
        <div className="flex items-center gap-3"><span className="text-xs text-fog">Preview:</span><Image src={f.imageUrl} alt="preview" width={48} height={48} className="size-12 rounded-full object-cover ring-1 ring-ink-600" /></div>
      )}
      <Input label="Tagline" value={f.tagline} onChange={set("tagline")} placeholder="One-line strapline" />
      <div>
        <Label>Biography</Label>
        <textarea value={f.bio} onChange={(e) => set("bio")(e.target.value)} rows={4} className="w-full resize-y rounded-lg border border-ink-700 bg-ink-950/50 p-3 text-sm text-chalk outline-none focus:border-blood-500/50" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Contact email" value={f.contactEmail} onChange={set("contactEmail")} placeholder="booking@…" />
        <Input label="Website" value={f.website} onChange={set("website")} placeholder="https://" />
        <Input label="Instagram" value={f.instagram} onChange={set("instagram")} placeholder="https://instagram.com/…" />
        <Input label="Twitter / X" value={f.twitter} onChange={set("twitter")} placeholder="https://x.com/…" />
      </div>
      <Button onClick={save} disabled={busy}>
        {busy ? <><Loader2 className="size-4 animate-spin" /> Saving…</> : saved ? <><Check className="size-4" /> Saved</> : "Save profile"}
      </Button>
    </div>
  );
}

function ListSection({ title, items, fields, onAdd, onDelete }: {
  title: string;
  items: { id: string; primary: string; secondary: string }[];
  fields: { key: string; placeholder: string; type?: string; width?: string }[];
  onAdd: (v: Record<string, string>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [v, setV] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true); setError(null);
    try { await onAdd(v); setV({}); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed."); }
    finally { setBusy(false); }
  }

  return (
    <div className="card-surface space-y-3 p-5">
      <h3 className="font-display text-sm font-bold uppercase tracking-wide text-fog">{title}</h3>
      {error && <p className="text-xs text-blood-300">{error}</p>}
      <ul className="space-y-1.5">
        {items.length === 0 && <li className="text-xs text-fog">Nothing added yet.</li>}
        {items.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink-950/40 px-3 py-2">
            <span className="min-w-0 truncate text-sm text-chalk">{i.primary}{i.secondary && <span className="text-fog"> · {i.secondary}</span>}</span>
            <button onClick={() => onDelete(i.id)} className="shrink-0 text-fog hover:text-blood-400"><Trash2 className="size-4" /></button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        {fields.map((fl) => (
          <input key={fl.key} type={fl.type ?? "text"} value={v[fl.key] ?? ""} onChange={(e) => setV((p) => ({ ...p, [fl.key]: e.target.value }))}
            placeholder={fl.placeholder} className={`h-10 ${fl.width ?? "min-w-[8rem] flex-1"} rounded-lg border border-ink-700 bg-ink-950/50 px-3 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50`} />
        ))}
        <Button size="sm" onClick={add} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add</Button>
      </div>
    </div>
  );
}

function SocialSection({ slug, socials, setSocials, post, del }: {
  slug: string;
  socials: { id: string; platform: string; url: string }[];
  setSocials: React.Dispatch<React.SetStateAction<{ id: string; platform: string; url: string }[]>>;
  post: (p: Record<string, unknown>) => Promise<{ id: string }>;
  del: (kind: ListKind, id: string) => Promise<boolean>;
}) {
  const [platform, setPlatform] = useState("youtube");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  void slug;

  async function add() {
    if (!url) return;
    setBusy(true);
    try {
      const r = await post({ type: "social", platform, url });
      setSocials((x) => [...x.filter((s) => s.platform !== platform), { id: r.id, platform, url }]);
      setUrl("");
    } catch { /* surfaced via alert path elsewhere */ } finally { setBusy(false); }
  }

  const opts = ["youtube", "tiktok", "facebook", "instagram", "twitter", "web"].map((p) => ({ value: p, label: p }));

  return (
    <div className="card-surface space-y-3 p-5">
      <h3 className="font-display text-sm font-bold uppercase tracking-wide text-fog">Social links</h3>
      <ul className="space-y-1.5">
        {socials.length === 0 && <li className="text-xs text-fog">Nothing added yet.</li>}
        {socials.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink-950/40 px-3 py-2">
            <span className="min-w-0 truncate text-sm text-chalk">{s.platform} · <span className="text-fog">{s.url}</span></span>
            <button onClick={async () => { if (await del("social", s.id)) setSocials((x) => x.filter((i) => i.id !== s.id)); }} className="shrink-0 text-fog hover:text-blood-400"><Trash2 className="size-4" /></button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-32"><FilterSelect value={platform} onChange={setPlatform} options={opts} placeholder="Platform" /></div>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="h-11 min-w-[8rem] flex-1 rounded-lg border border-ink-700 bg-ink-950/50 px-3 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50" />
        <Button size="sm" onClick={add} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add</Button>
      </div>
    </div>
  );
}

function MediaSection({ title, mediaType, items, setItems, post, del }: {
  title: string; mediaType: "photo" | "video";
  items: { id: string; url: string; caption: string | null }[];
  setItems: React.Dispatch<React.SetStateAction<{ id: string; url: string; caption: string | null }[]>>;
  post: (p: Record<string, unknown>) => Promise<{ id: string }>;
  del: (kind: ListKind, id: string) => Promise<boolean>;
}) {
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!url) return;
    setBusy(true); setError(null);
    try {
      const r = await post({ type: "media", mediaType, url, caption });
      setItems((x) => [...x, { id: r.id, url, caption: caption || null }]);
      setUrl(""); setCaption("");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed."); } finally { setBusy(false); }
  }

  return (
    <div className="card-surface space-y-3 p-5">
      <h3 className="font-display text-sm font-bold uppercase tracking-wide text-fog">{title}</h3>
      {error && <p className="text-xs text-blood-300">{error}</p>}
      <div className="grid grid-cols-3 gap-2">
        {items.length === 0 && <p className="col-span-3 text-xs text-fog">Nothing added yet.</p>}
        {items.map((m) => (
          <div key={m.id} className="group relative aspect-square overflow-hidden rounded-lg bg-ink-800">
            {mediaType === "photo"
              ? <Image src={m.url} alt={m.caption ?? ""} fill className="object-cover" sizes="120px" />
              : <div className="flex size-full items-center justify-center p-2 text-center text-[0.6rem] text-fog">{m.caption || "video"}</div>}
            <button onClick={async () => { if (await del("media", m.id)) setItems((x) => x.filter((i) => i.id !== m.id)); }} className="absolute right-1 top-1 rounded bg-ink-950/80 p-1 text-fog opacity-0 transition-opacity group-hover:opacity-100 hover:text-blood-400"><Trash2 className="size-3.5" /></button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={mediaType === "photo" ? "Image URL https://…" : "YouTube/Vimeo URL"} className="h-10 min-w-[8rem] flex-1 rounded-lg border border-ink-700 bg-ink-950/50 px-3 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50" />
        <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption" className="h-10 w-28 rounded-lg border border-ink-700 bg-ink-950/50 px-3 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50" />
        <Button size="sm" onClick={add} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add</Button>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-fog">{children}</span>;
}
function Input({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-11 w-full rounded-lg border border-ink-700 bg-ink-950/50 px-3 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50" />
    </label>
  );
}
