"use client";

import type { ExtractionResult } from "./questionBank";

// Browser-side recording + thin fetch wrappers to the server endpoints. No
// OpenAI access here — everything sensitive happens server-side.

export type RecordingHandle = {
  stop: () => Promise<Blob>;
  cancel: () => void;
};

function pickMime(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  if (typeof MediaRecorder === "undefined") return undefined;
  return candidates.find((c) => MediaRecorder.isTypeSupported(c));
}

export function isRecordingSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

export async function startRecording(): Promise<RecordingHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickMime();
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: BlobPart[] = [];
  mr.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };
  mr.start();

  const cleanup = () => stream.getTracks().forEach((t) => t.stop());

  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        mr.onstop = () => {
          cleanup();
          resolve(new Blob(chunks, { type: mr.mimeType || "audio/webm" }));
        };
        mr.stop();
      }),
    cancel: () => {
      try {
        mr.stop();
      } catch {
        /* ignore */
      }
      cleanup();
    },
  };
}

export async function transcribe(blob: Blob): Promise<string> {
  const fd = new FormData();
  const ext = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm";
  fd.append("audio", blob, `answer.${ext}`);
  const res = await fetch("/api/transcribe", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Transcription failed.");
  return (data.transcript as string) || "";
}

export async function extract(questionId: string, transcript: string): Promise<ExtractionResult> {
  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionId, transcript }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Extraction failed.");
  return data as ExtractionResult;
}

export async function uploadPhotos(
  files: File[],
): Promise<{ fileName: string; storedName: string; localUrl: string }[]> {
  const fd = new FormData();
  files.forEach((f) => fd.append("photos", f));
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Upload failed.");
  return data.saved;
}
