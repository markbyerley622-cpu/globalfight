"use client";

import { useState } from "react";
import { Loader2, Users, Lock, Globe } from "lucide-react";
import type { GymPostDTO, Visibility } from "@/lib/gym-posts/types";
import { MAX_BODY_CHARS, MAX_MEDIA_PER_POST } from "@/lib/gym-posts/types";
import { IMAGE_ACCEPT, MAX_UPLOAD_MB } from "@/lib/images/limits";
import { Composer } from "@/components/composer/composer";
import { useEntityPicks } from "@/lib/composer/entities";
import { clearDraft } from "@/lib/composer/drafts";
import { useComposerUploads } from "@/lib/composer/attachments";
import { useMediaAction } from "@/components/composer/toolbar";

// ════════════════════════════════════════════════════════════════════════════
//  THE COMPOSER.
//
//  ── It does not upload anything itself ───────────────────────────────────
//  Every file goes to POST /api/media — the one door to the media lifecycle —
//  and what comes back is an ASSET ID. The composer never sees a bucket, a key
//  or a signed URL, and the post it finally submits carries ids, not files.
//  That separation is what makes an image survive a failed post and a post
//  survive a failed image.
//
//  ── Why upload on SELECT rather than on submit ───────────────────────────
//  Because the scan is not instant. Uploading at submit time means the author
//  writes their post, presses Publish, and then waits while ten files are
//  validated, scanned and re-encoded — with nothing to look at and no way to
//  fix the one that fails. Uploading as each file is chosen turns that into
//  progress bars they can watch and retry individually, and by the time the
//  text is written the images are usually already READY.
//
//  The cost is that abandoning the composer leaves uploaded assets nobody
//  attached. That is exactly what the reference counting and the cleanup sweep
//  are for: an unattached asset holds no reference and is collected.
//
//  ── XMLHttpRequest, deliberately ─────────────────────────────────────────
//  fetch() still cannot report UPLOAD progress. On a phone posting a 6 MB photo
//  that is the difference between a progress bar and a frozen screen, so this
//  one place uses XHR and says why.
// ════════════════════════════════════════════════════════════════════════════

// The private Attachment type, its XHR upload, accept/retry/remove and the
// object-URL bookkeeping all lived here. They are now lib/composer/attachments,
// used by every surface — deleted rather than wrapped, so there is one upload
// lifecycle in the app instead of this one and the forums' weaker one.

const VISIBILITY_LOOK: Record<Visibility, { icon: typeof Globe; label: string; help: string }> = {
  PUBLIC: { icon: Globe, label: "Public", help: "Anyone can see this." },
  MEMBERS: { icon: Users, label: "Members", help: "Only members of this gym." },
  PRIVATE: { icon: Lock, label: "Private", help: "Only you and the gym's owner." },
};

export function GymComposer({
  gymSlug,
  gymName,
  onPublished,
}: {
  gymSlug: string;
  gymName: string;
  onPublished: (post: GymPostDTO) => void;
}) {
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("PUBLIC");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // WHO was picked, not where. Offsets are computed once from the final text at
  // submit — see lib/composer/entities for why tracking them per keystroke is
  // the thing that silently drifts.
  const mentions = useEntityPicks();
  const uploads = useComposerUploads<string>({
    uploader: {
      endpoint: "/api/media",
      extra: { sourceType: "gym-post" },
      // A 200 with no assetId has not delivered anything — parse returns null
      // and the engine marks it failed rather than producing a phantom
      // attachment that vanishes at publish time.
      parse: (json) => (json as { assetId?: string })?.assetId ?? null,
    },
    max: MAX_MEDIA_PER_POST,
    // The project's own ceiling, not a number invented here — the server
    // enforces the same one, and two copies would drift.
    maxBytes: MAX_UPLOAD_MB * 1024 * 1024,
    accept: ["image/"],
  });
  const media = useMediaAction(uploads, { accept: IMAGE_ACCEPT });

  async function publish() {
    if (!body.trim() && uploads.ready.length === 0) {
      setError("Write something, or add a photo.");
      return;
    }
    if (uploads.busy) {
      setError("Wait for the photos to finish uploading.");
      return;
    }

    setPublishing(true);
    setError(null);
    try {
      const res = await fetch("/api/gym/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gym: gymSlug,
          body,
          // Built from the FINAL text, so a mention the author typed and then
          // deleted produces nothing and one they duplicated produces two.
          entities: mentions.build(body),
          visibility,
          media: uploads.ready.map((assetId) => ({ assetId })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Couldn't publish that.");

      onPublished(data.post as GymPostDTO);
      uploads.clear();
      setBody("");
      // Only after a SUCCESSFUL publish. Resetting in `finally` would drop the
      // picks behind a body the author still has in front of them, so a retry
      // would send the same text with its mentions silently downgraded.
      mentions.reset();
      clearDraft(`gym-post:${gymSlug}`);
    } catch (e) {
      // The text and the attachments are left exactly as they were. A failed
      // publish that clears the composer is how people lose what they wrote.
      setError(e instanceof Error ? e.message : "Couldn't publish that.");
    } finally {
      setPublishing(false);
    }
  }

  const Icon = VISIBILITY_LOOK[visibility].icon;

  return (
    <section className="card-surface p-4" aria-label={`Post to ${gymName}`}>
      {/* Drag-and-drop, the drop overlay and the attachment grid are the
          Composer's now. Paste-to-attach passes straight through: the Composer
          spreads unknown textarea props onto the element, so a surface keeps
          its own extras without the Composer knowing about them. */}
      <Composer
        mentions={mentions}
        value={body}
        onChange={setBody}
        maxLength={MAX_BODY_CHARS}
        showCount
        draftKey={`gym-post:${gymSlug}`}
        uploads={uploads as never}
        actions={[media.action]}
        // Paste-to-attach. Screenshots and phone photos arrive on the clipboard
        // far more often than through a file picker.
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (files.length > 0) { e.preventDefault(); uploads.addFiles(files); }
        }}
        rows={3}
        placeholder={`Share something with ${gymName}…`}
        aria-label="What do you want to say?"
        className="w-full resize-y rounded-lg border border-ink-700 bg-ink-950 px-3 py-2.5 text-sm leading-relaxed text-chalk placeholder:text-fog focus:border-blood-500/50 focus:outline-none"
      />

      {media.input}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex min-h-11 items-center gap-1.5 rounded-lg border border-ink-700 px-3 text-xs font-semibold text-mist">
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className="sr-only">Who can see this</span>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as Visibility)}
            className="bg-transparent text-xs font-semibold text-mist focus:outline-none"
          >
            <option value="PUBLIC">Public</option>
            <option value="MEMBERS">Members</option>
            <option value="PRIVATE">Private</option>
          </select>
        </label>

        <span className="flex-1" />

        <button
          type="button"
          onClick={publish}
          disabled={publishing || uploads.busy}
          className="tap flex min-h-11 items-center gap-2 rounded-lg bg-blood-500/90 px-5 text-xs font-bold uppercase tracking-wide text-chalk transition-colors hover:bg-blood-500 disabled:opacity-50"
        >
          {publishing && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {publishing ? "Posting…" : "Post"}
        </button>
      </div>

      <p className="mt-1.5 text-2xs text-fog">
        {VISIBILITY_LOOK[visibility].help} Drag, paste or pick up to {MAX_MEDIA_PER_POST} images, {MAX_UPLOAD_MB} MB each.
      </p>

      {error && <p role="alert" className="mt-1.5 text-2xs text-blood-300">{error}</p>}
    </section>
  );
}
