import './index.css';

import { requestExpandedMode } from '@devvit/web/client';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { fetchBootstrap } from './state/api';

type Stats = {
  objects: number;
  builders: number;
  height: number;
};

export const Splash = () => {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchBootstrap();
      if (cancelled) return;
      if ('type' in res) {
        setStats({
          objects: res.tower.meta.successfulPlacements,
          builders: res.tower.meta.uniqueContributors,
          height: Math.round(res.tower.meta.height),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[#181a20] px-6 text-center text-slate-100">
      <div className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-300">
        One More Thing
      </div>
      <h1 className="max-w-xs text-lg font-bold leading-snug text-slate-100">
        Everyone builds the same tower. Add one object — if it stays, it becomes the
        next player&apos;s problem.
      </h1>

      <div className="flex gap-5 text-slate-300">
        <Stat label="objects" value={stats ? String(stats.objects) : '—'} />
        <Stat label="builders" value={stats ? String(stats.builders) : '—'} />
        <Stat label="height" value={stats ? String(stats.height) : '—'} />
      </div>

      <button
        onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
        className="rounded-full bg-orange-500 px-8 py-3 text-base font-bold text-white shadow-lg transition-colors hover:bg-orange-400"
      >
        Add One More Thing
      </button>

      {/* ===== DEV launchers (Task 3 sandbox + Task 4 gallery) — remove later ===== */}
      <div className="flex gap-4">
        <button
          onClick={(e) => requestExpandedMode(e.nativeEvent, 'sandbox')}
          className="text-[11px] text-slate-500 underline underline-offset-2 hover:text-slate-300"
        >
          🧪 physics sandbox
        </button>
        <button
          onClick={(e) => requestExpandedMode(e.nativeEvent, 'gallery')}
          className="text-[11px] text-slate-500 underline underline-offset-2 hover:text-slate-300"
        >
          🗂 object gallery
        </button>
      </div>
      {/* ======================================================================== */}
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
