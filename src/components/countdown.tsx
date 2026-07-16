"use client";

import { useEffect, useState } from "react";

function diff(target: number) {
  const d = target - Date.now();
  if (d <= 0) return null;
  return {
    days: Math.floor(d / 86400000),
    hours: Math.floor((d % 86400000) / 3600000),
    minutes: Math.floor((d % 3600000) / 60000),
    seconds: Math.floor((d % 60000) / 1000),
  };
}

export function Countdown({ date, compact = false }: { date: string; compact?: boolean }) {
  const target = new Date(date).getTime();
  const [t, setT] = useState<ReturnType<typeof diff>>(null);

  useEffect(() => {
    setT(diff(target));
    const id = setInterval(() => setT(diff(target)), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (!t) return <span className="font-display text-sm font-bold uppercase text-blood-400">Live / Final</span>;

  const cell = (v: number, l: string) => (
    <div className="flex flex-col items-center">
      <span className="font-display text-xl font-bold tabular-nums text-chalk sm:text-2xl">
        {String(v).padStart(2, "0")}
      </span>
      <span className="text-[0.6rem] uppercase tracking-wider text-fog">{l}</span>
    </div>
  );

  if (compact) {
    return (
      <span className="font-display text-sm font-bold tabular-nums text-chalk">
        {t.days}d {String(t.hours).padStart(2, "0")}h {String(t.minutes).padStart(2, "0")}m
      </span>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {cell(t.days, "Days")}
      <span className="text-fog">:</span>
      {cell(t.hours, "Hrs")}
      <span className="text-fog">:</span>
      {cell(t.minutes, "Min")}
      <span className="text-fog">:</span>
      {cell(t.seconds, "Sec")}
    </div>
  );
}
