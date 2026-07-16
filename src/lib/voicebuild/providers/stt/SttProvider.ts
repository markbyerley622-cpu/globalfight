// STT provider contract + result shape (types only — safe to import anywhere).

export type SttProviderName = "deepgram" | "openai" | "mock";

export type TranscriptionWord = {
  text: string;
  start?: number;
  end?: number;
  confidence?: number;
};

export type TranscriptionResult = {
  provider: SttProviderName;
  transcript: string;
  language?: string;
  durationMs?: number;
  confidence?: number;
  words?: TranscriptionWord[];
  raw?: unknown; // stripped before leaving the server
};

export type TranscribeInput = {
  buffer: Buffer;
  mimeType: string;
  fileName?: string;
};

export interface SttProvider {
  readonly name: SttProviderName;
  transcribeAudio(input: TranscribeInput): Promise<TranscriptionResult>;
}

/** Client-safe view of a transcription — no `raw`. */
export function sanitizeTranscription(r: TranscriptionResult): TranscriptionResult {
  const { raw: _drop, ...rest } = r;
  void _drop;
  return rest;
}
