/**
 * Fixture clock. Mock timestamps are expressed as offsets from the moment the
 * app loads so that "live", "upcoming" and "completed" events always look
 * realistic during a demo, rather than drifting into the past.
 *
 * When this skeleton is wired to a real backend, timestamps arrive as absolute
 * ISO strings and this module is dropped.
 */
const BASE = new Date();

function iso(offsetMs: number): string {
  return new Date(BASE.getTime() + offsetMs).toISOString();
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const clock = {
  base: BASE,
  now: () => new Date(),
  minutesFromNow: (m: number) => iso(m * MIN),
  hoursFromNow: (h: number) => iso(h * HOUR),
  daysFromNow: (d: number) => iso(d * DAY),
  minutesAgo: (m: number) => iso(-m * MIN),
  hoursAgo: (h: number) => iso(-h * HOUR),
  daysAgo: (d: number) => iso(-d * DAY),
};
