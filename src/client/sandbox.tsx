import './index.css';

import type PhaserNS from 'phaser';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getObjectDef } from '../shared/objects';
import { createSandboxGame } from './phaser/sandboxBoot';
import { SANDBOX_OBJECT_IDS, SandboxController, type SandboxPhase } from './phaser/sandbox';

const firstName = (() => {
  const id = SANDBOX_OBJECT_IDS[0];
  return id ? (getObjectDef(id)?.name ?? '') : '';
})();

export const Sandbox = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<PhaserNS.Game | null>(null);
  const controllerRef = useRef<SandboxController | null>(null);

  const [phase, setPhase] = useState<SandboxPhase>('empty');
  const [nextName, setNextName] = useState<string>(firstName);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const controller = new SandboxController();
    controllerRef.current = controller;
    controller.onPhase = (p) => setPhase(p);
    controller.onObject = (name) => setNextName(name);

    const game = createSandboxGame(container, controller);
    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
      controllerRef.current = null;
    };
  }, []);

  const c = () => controllerRef.current;
  const placing = phase === 'placing';

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#181a20] text-slate-100 select-none">
      <div ref={containerRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-3">
        <div className="pointer-events-auto rounded-lg bg-black/50 px-3 py-1.5 text-[12px] backdrop-blur-sm">
          <span className="font-semibold text-amber-200">🧪 Physics Sandbox</span>
          <span className="ml-2 text-slate-400">local · nothing is saved</span>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-4">
        <p className="text-[11px] text-slate-400">Drag to move · rotate · drop</p>

        <div className="pointer-events-auto flex w-full max-w-sm items-center justify-between gap-3">
          <button
            onClick={() => c()?.rotate(-1)}
            disabled={!placing}
            className="h-14 w-14 rounded-full bg-slate-700/80 text-2xl font-bold text-white active:bg-slate-600 disabled:opacity-40"
            aria-label="Rotate left"
          >
            ⟲
          </button>
          <button
            onClick={() => c()?.drop()}
            disabled={!placing}
            className="h-16 flex-1 rounded-2xl bg-orange-500 text-lg font-black tracking-wide text-white shadow-lg active:bg-orange-400 disabled:opacity-40"
          >
            DROP
          </button>
          <button
            onClick={() => c()?.rotate(1)}
            disabled={!placing}
            className="h-14 w-14 rounded-full bg-slate-700/80 text-2xl font-bold text-white active:bg-slate-600 disabled:opacity-40"
            aria-label="Rotate right"
          >
            ⟳
          </button>
        </div>

        <div className="pointer-events-auto flex w-full max-w-sm items-center gap-3">
          <button
            onClick={() => c()?.reset()}
            className="h-11 flex-1 rounded-xl bg-slate-700/80 text-sm font-bold text-white active:bg-slate-600"
          >
            Reset
          </button>
          <button
            onClick={() => c()?.spawnNext()}
            className="h-11 flex-[2] rounded-xl bg-emerald-600 text-sm font-bold text-white active:bg-emerald-500"
          >
            {placing ? `Swap → ${nextName}` : `Spawn ${nextName} ▸`}
          </button>
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sandbox />
  </StrictMode>
);
