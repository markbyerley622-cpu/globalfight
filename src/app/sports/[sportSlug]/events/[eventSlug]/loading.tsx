/** Skeleton loading state for the event destination. */
export default function Loading() {
  return (
    <div className="animate-pulse px-4 py-6">
      <div className="h-4 w-24 rounded bg-surface-2" />
      <div className="mt-3 h-7 w-3/4 rounded bg-surface-2" />
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="h-12 rounded-lg bg-surface-2" />
        <div className="h-12 rounded-lg bg-surface-2" />
      </div>
      <div className="mt-6 h-24 rounded-xl bg-surface-2" />
      <div className="mt-3 h-40 rounded-xl bg-surface-2" />
    </div>
  );
}
