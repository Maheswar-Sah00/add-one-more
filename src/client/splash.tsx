import './index.css';

import { requestExpandedMode } from '@devvit/web/client';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getModifier } from '../shared/modifiers';
import { dayNumber } from '../shared/post';
import { fetchBootstrap } from './state/api';

type SplashData = {
  day: number;
  modifierLabel: string;
  modifierDescription: string;
  modifierIsNormal: boolean;
  objects: number;
  builders: number;
  height: number;
  endsAt: number;
  finalized: boolean;
};

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'closed for today';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

export const Splash = () => {
  const [data, setData] = useState<SplashData | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchBootstrap();
      if (cancelled || !('type' in res)) return;
      const meta = res.tower.meta;
      const mod = getModifier(meta.modifierId);
      setData({
        day: dayNumber(meta.dayKey),
        modifierLabel: mod.label,
        modifierDescription: mod.description,
        modifierIsNormal: mod.id === 'normal',
        objects: meta.successfulPlacements,
        builders: meta.uniqueContributors,
        height: Math.round(meta.height),
        endsAt: meta.endsAt,
        finalized: meta.status === 'finalized',
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const remaining = data ? formatRemaining(data.endsAt - now) : '';

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[#181a20] px-6 py-5 text-center text-slate-100">
      <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-300">
        One More Thing{data ? ` · Day ${data.day}` : ''}
      </div>

      <h1 className="max-w-xs text-lg font-bold leading-snug text-slate-100">
        Everyone builds the same tower. Add one object — if it stays, it becomes the
        next player&apos;s problem.
      </h1>

      {/* Daily modifier. */}
      {data && !data.modifierIsNormal && (
        <div className="max-w-xs rounded-lg border border-sky-400/40 bg-sky-500/10 px-3 py-1.5 text-[11px] text-sky-100">
          <span className="font-bold">✦ {data.modifierLabel}</span> — {data.modifierDescription}
        </div>
      )}

      {/* Live stats. */}
      <div className="flex gap-5 text-slate-300">
        <Stat label="objects" value={data ? String(data.objects) : '—'} />
        <Stat label="builders" value={data ? String(data.builders) : '—'} />
        <Stat label="height" value={data ? String(data.height) : '—'} />
      </div>

      {/* Basic instructions. */}
      <ol className="max-w-xs space-y-0.5 text-left text-[11px] leading-snug text-slate-400">
        <li>1. Pick an object and drop it onto the shared tower.</li>
        <li>2. If it stays standing, it’s saved for the next player.</li>
        <li>3. You get one successful addition per day.</li>
      </ol>

      {/* Interactive CTA → expands to the game surface. */}
      <button
        onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
        className="rounded-full bg-orange-500 px-8 py-3 text-base font-bold text-white shadow-lg transition-colors hover:bg-orange-400"
      >
        {data?.finalized ? 'See today’s results' : 'Add One More Thing'}
      </button>

      {/* Daily ending + community call to action. */}
      <div className="text-[11px] text-slate-400">
        {data
          ? data.finalized
            ? 'Today’s tower is finished. A new one starts tomorrow.'
            : `Tower ${remaining} · help the community reach the next milestone.`
          : 'Loading today’s tower…'}
      </div>
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col items-center">
    <div className="text-xl font-black text-slate-100">{value}</div>
    <div className="text-[10px] uppercase tracking-widest text-slate-400">{label}</div>
  </div>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
