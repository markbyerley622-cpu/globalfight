"use client";

import { useRef, useState } from "react";
import { X, Mic, Square, Loader2, Wand2, ShieldCheck, Check, RotateCcw } from "lucide-react";
import { isRecordingSupported, startRecording, type RecordingHandle } from "@/lib/voicebuild/voiceClient";
import { intake } from "@/lib/voicebuild/providersClient";
import { emptyProfile, type FighterProfile } from "@/lib/voicebuild/fighterProfileSchema";
import { applyCandidates, buildMergeCandidates, safeCandidates } from "@/lib/voicebuild/utils/profileMerge";

// Origin of the mr-2 app that hosts the real fighter-website template.
const MR2_ORIGIN = process.env.NEXT_PUBLIC_MR2_ORIGIN || "http://localhost:3000";

// Say everything in one take; the whole thing is transcribed + extracted and
// the site template is filled with it. "Generate website" unlocks the filled
// template. No step-by-step questions, no data table.
const SCRIPT = [
  "My name is ___, and my nickname is ___.",
  "My tagline is ___.",
  "I'm from ___, and I live in ___.",
  "I fight at ___ (kilos or pounds).",
  "My record is ___ wins, ___ losses, ___ draws, and ___ KOs.",
  "My short bio: ___.",
  "My business enquiries email is ___.",
  "My socials are ___. My sponsors are ___.",
];

type Rec = "idle" | "recording" | "processing";

export function VoiceClaim({ slug: _slug, onClose, onVerifyId }: { slug: string; onClose: () => void; onVerifyId?: () => void }) {
  const [profile, setProfile] = useState<FighterProfile>(emptyProfile);
  const [rec, setRec] = useState<Rec>("idle");
  const [captured, setCaptured] = useState<string[]>([]);
  const [built, setBuilt] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<RecordingHandle | null>(null);

  // The real mr-2 template, filled with the collected profile via ?data=.
  const previewSrc = `${MR2_ORIGIN}/onboarding/preview?data=${encodeURIComponent(JSON.stringify(profile))}`;

  const record = async () => {
    setError(null);
    try {
      handleRef.current = await startRecording();
      setRec("recording");
    } catch {
      setError("Microphone unavailable or permission denied.");
      setRec("idle");
    }
  };

  const stop = async () => {
    if (!handleRef.current) return;
    setRec("processing");
    try {
      const blob = await handleRef.current.stop();
      handleRef.current = null;
      const res = await intake(blob, profile);
      if (!res.ok) {
        setError(`${res.error}${res.hint ? ` ${res.hint}` : ""}`);
        setRec("idle");
        return;
      }
      const safe = safeCandidates(buildMergeCandidates(profile, res.extraction, new Set()));
      setProfile((p) => applyCandidates(p, safe));
      setCaptured(safe.map((c) => c.label));
      setBuilt(true);
    } catch {
      setError("Voice processing failed. Please try again.");
    } finally {
      setRec("idle");
    }
  };

  const reset = () => {
    setProfile(emptyProfile());
    setCaptured([]);
    setBuilt(false);
    setGenerated(false);
    setError(null);
  };

  return (
    <div className="fixed inset-0 z-[120] overflow-hidden bg-ink-950">
      {/* the real MR-2 template (mr-2 app), FILLED via ?data= — blurred until generated */}
      <iframe
        key={generated ? "gen" : "preview"}
        src={previewSrc}
        title="Your website"
        className={`absolute inset-0 h-full w-full border-0 transition-all duration-700 ${generated ? "" : "scale-105 blur-lg brightness-[0.4]"}`}
      />

      <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 z-20 rounded-full bg-ink-800/80 p-2 text-mist backdrop-blur hover:text-chalk">
        <X className="size-5" />
      </button>

      {!generated && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
          <div className="w-full max-w-lg rounded-3xl border border-ink-700 bg-ink-900/90 p-8 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center gap-2 text-blood-400">
              <ShieldCheck className="size-5" />
              <p className="font-display text-xs font-bold uppercase tracking-[0.25em]">Claim profile</p>
            </div>
            <h2 className="mt-2 font-display text-3xl font-black text-chalk">Build your website by voice</h2>
            <p className="mt-2 text-sm text-mist">Say it all in one take — we fill the site behind this box. Skip anything you don&apos;t have.</p>

            {!built && (
              <div className="mt-5 rounded-xl border border-ink-700 bg-ink-950/60 p-4">
                {SCRIPT.map((line, i) => (
                  <p key={i} className="text-sm leading-relaxed text-mist">{line}</p>
                ))}
              </div>
            )}

            <div className="mt-7 flex flex-col items-center gap-3">
              {rec === "recording" ? (
                <button onClick={stop} className="flex size-20 animate-pulse items-center justify-center rounded-full bg-blood-500 text-white shadow-lg ring-4 ring-blood-500/30">
                  <Square className="size-7" />
                </button>
              ) : rec === "processing" ? (
                <div className="flex size-20 items-center justify-center rounded-full bg-ink-800 text-mist">
                  <Loader2 className="size-7 animate-spin" />
                </div>
              ) : (
                <button onClick={record} disabled={!isRecordingSupported()} className="flex size-20 items-center justify-center rounded-full bg-blood-500 text-white shadow-lg transition hover:brightness-110 disabled:opacity-40">
                  <Mic className="size-8" />
                </button>
              )}
              <span className="text-xs uppercase tracking-wide text-fog">
                {rec === "recording" ? "Recording — tap to stop" : rec === "processing" ? "Building your site…" : built ? "Tap to add more" : "Tap to speak"}
              </span>
            </div>

            {error && <p className="mt-4 text-center text-sm text-blood-400">{error}</p>}

            {built && (
              <div className="mt-6">
                {captured.length > 0 && (
                  <p className="flex flex-wrap items-center justify-center gap-1.5 text-center text-sm text-up">
                    <Check className="size-4" /> Captured: {captured.join(", ")}
                  </p>
                )}
                <div className="mt-5 flex gap-3">
                  <button onClick={reset} className="flex items-center justify-center gap-2 rounded-xl border border-ink-700 px-4 py-3 text-sm text-mist hover:text-chalk">
                    <RotateCcw className="size-4" /> Redo
                  </button>
                  <button onClick={() => setGenerated(true)} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blood-500 px-6 py-3 font-display text-sm font-bold uppercase tracking-wide text-white transition hover:brightness-110">
                    <Wand2 className="size-4" /> Generate website
                  </button>
                </div>
              </div>
            )}

            {onVerifyId && (
              <button onClick={onVerifyId} className="mt-6 block w-full text-center text-xs font-semibold text-fog underline decoration-ink-600 underline-offset-2 hover:text-mist">
                Verify with ID instead
              </button>
            )}
          </div>
        </div>
      )}

      {generated && (
        <div className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2 flex gap-3">
          <button onClick={() => setGenerated(false)} className="rounded-full border border-ink-600 bg-ink-900/80 px-5 py-2 text-sm text-mist backdrop-blur hover:text-chalk">
            Edit by voice
          </button>
          <button onClick={onClose} className="rounded-full bg-blood-500 px-6 py-2 text-sm font-semibold text-white">
            Done
          </button>
        </div>
      )}
    </div>
  );
}
