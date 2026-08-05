// Reserves roughly what /today renders. The streak card is the first thing on
// the page and the tallest single block, so a skeleton that ignores it would
// shove the whole digest down the moment the data lands.
export default function Loading() {
  return (
    <div className="px-4 pb-16 pt-5" aria-busy="true">
      <div className="mx-auto max-w-2xl">
        <div className="mb-5 space-y-2">
          <div className="h-3 w-32 rounded bg-ink-800" />
          <div className="h-7 w-48 rounded bg-ink-800" />
          <div className="h-3 w-64 rounded bg-ink-850" />
        </div>
        <div className="h-[13.5rem] rounded-card border border-ink-800 bg-ink-900/50" />
        {[0, 1].map((i) => (
          <div key={i} className="mt-8">
            <div className="mb-3 h-3 w-40 rounded bg-ink-800" />
            <div className="h-40 rounded-card border border-ink-800 bg-ink-900/50" />
          </div>
        ))}
      </div>
    </div>
  );
}
