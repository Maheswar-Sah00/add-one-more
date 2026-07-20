/* eslint-disable react-refresh/only-export-components -- single-entry game bundle, not a fast-refresh module */
import './index.css';

import Phaser from 'phaser';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DIFFICULTY_ORDER, getObjectDef, objectsByTier, type GameObjectDef } from '../shared/objects';
import type { PersistedBodyState } from '../shared/types';
import { objectArtUrl } from './objectArt';
import { CATEGORY_HEX, CATEGORY_LABEL, objectIconSvg, type Choice } from './phaser/gameObjects';
import { TowerScene, type Phase } from './phaser/TowerScene';

// ---- small building blocks -------------------------------------------------

/**
 * An object's icon: the real bundled artwork if present, otherwise the
 * procedural flat-shaded SVG. Keeps the tray, catalog and detail views in sync
 * with whatever the physics tower renders.
 */
const ObjectIcon = ({ def, size }: { def: GameObjectDef; size: number }) => {
  const art = objectArtUrl(def.id);
  if (art) {
    return (
      <img
        src={art}
        alt={def.name}
        draggable={false}
        className="object-contain"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="flex items-center justify-center"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: objectIconSvg(def, size) }}
    />
  );
};

const Wordmark = () => (
  <div className="select-none text-[15px] font-black italic leading-none tracking-tight">
    <span className="text-[#2f2540]">One </span>
    <span className="text-[#e6a91e]">More </span>
    <span className="text-[#2f2540]">Thing</span>
  </div>
);

/** A tray object choice: category label, illustration, short name. */
const ChoiceTile = ({
  choice,
  selectedId,
  onPick,
}: {
  choice: Choice;
  selectedId: string | null;
  onPick: (id: string) => void;
}) => {
  const def = getObjectDef(choice.id);
  const isSelected = selectedId === choice.id;
  const dimmed = selectedId !== null && !isSelected;
  const accent = CATEGORY_HEX[choice.category];
  return (
    <button
      onClick={() => onPick(choice.id)}
      disabled={selectedId !== null}
      className={`flex flex-1 cursor-pointer flex-col items-center gap-0.5 rounded-xl border-b-[3px] bg-white/75 px-1.5 py-1.5 shadow-sm shadow-black/5 ring-1 ring-black/5 transition-all duration-200 ${
        dimmed ? 'scale-90 opacity-0' : isSelected ? 'scale-95' : 'hover:-translate-y-0.5'
      }`}
      style={{ borderBottomColor: accent }}
    >
      <span className="text-[8px] font-black uppercase tracking-[0.12em]" style={{ color: accent }}>
        {CATEGORY_LABEL[choice.category]}
      </span>
      {def && <ObjectIcon def={def} size={30} />}
      <span className="text-[9.5px] font-bold leading-tight text-[#2f2540]">{def?.name ?? choice.id}</span>
    </button>
  );
};

const RotateButton = ({ dir, onRotate }: { dir: -1 | 1; onRotate: (d: -1 | 1) => void }) => (
  <button
    onClick={() => onRotate(dir)}
    aria-label={dir === -1 ? 'Rotate left' : 'Rotate right'}
    className="flex h-14 w-14 cursor-pointer items-center justify-center rounded-2xl bg-white/80 text-2xl text-[#2f2540] shadow-md shadow-black/5 ring-1 ring-black/5 transition-transform duration-150 hover:-translate-y-0.5 active:scale-95"
  >
    {dir === -1 ? '↺' : '↻'}
  </button>
);

// ---- first-run walkthrough -------------------------------------------------

const INTRO_KEY = 'omt-intro-seen';

const introSeen = (): boolean => {
  try {
    return localStorage.getItem(INTRO_KEY) === '1';
  } catch {
    return false;
  }
};

const HowToStep = ({ n, icon, text }: { n: number; icon: string; text: string }) => (
  <div className="flex items-center gap-3">
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f4c02c] text-base font-black text-[#2f2540] ring-1 ring-black/5">
      {n}
    </div>
    <div className="flex items-center gap-2 text-[13px] font-semibold leading-snug text-[#3a2e4d]">
      <span className="text-lg">{icon}</span>
      <span>{text}</span>
    </div>
  </div>
);

const HowToPlay = ({ onClose }: { onClose: () => void }) => (
  <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-[#2f2540]/35 px-6 backdrop-blur-[2px]">
    <div className="w-full max-w-[330px] rounded-3xl bg-[#f6efdd] p-5 text-center shadow-2xl ring-1 ring-black/10">
      <div className="text-[11px] font-black uppercase tracking-[0.3em] text-indigo-500/80">One More Thing</div>
      <div className="mt-1 text-xl font-black text-[#2f2540]">How to play</div>
      <div className="mt-4 flex flex-col gap-3.5 text-left">
        <HowToStep n={1} icon="🧱" text="Pick one object — Safe, Risky or Absurd." />
        <HowToStep n={2} icon="↔️" text="Slide it and rotate to line up your drop." />
        <HowToStep n={3} icon="⬇️" text="Drop it. If the tower stays standing, it’s in!" />
      </div>
      <button
        onClick={onClose}
        className="mt-5 w-full cursor-pointer rounded-2xl border-b-[5px] border-[#d09a12] bg-[#f4c02c] py-3 text-base font-black tracking-wide text-[#2f2540] shadow-lg shadow-yellow-900/15 transition-all duration-150 hover:brightness-[1.03] active:translate-y-[3px] active:border-b-2"
      >
        Start building
      </button>
    </div>
  </div>
);

// ---- object catalog --------------------------------------------------------

/** One object cell in the catalog grid. */
const CatalogCell = ({
  def,
  active,
  onSelect,
}: {
  def: GameObjectDef;
  active: boolean;
  onSelect: (def: GameObjectDef) => void;
}) => {
  return (
    <button
      onClick={() => onSelect(def)}
      className={`flex cursor-pointer flex-col items-center gap-1 rounded-2xl border-b-[3px] bg-white/75 px-1.5 py-2 ring-1 transition-all duration-150 hover:-translate-y-0.5 ${
        active ? 'ring-2 ring-[#2f2540]/40' : 'ring-black/5'
      }`}
      style={{ borderBottomColor: CATEGORY_HEX[def.difficulty] }}
    >
      <ObjectIcon def={def} size={40} />
      <span className="text-center text-[9px] font-bold leading-tight text-[#2f2540]">{def.name}</span>
    </button>
  );
};

/** Full catalog of every playable object, grouped by risk tier. */
const Catalog = ({ onClose }: { onClose: () => void }) => {
  const [sel, setSel] = useState<GameObjectDef | null>(null);
  return (
    <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-[#2f2540]/40 px-4 py-6 backdrop-blur-[2px]">
      <div className="flex max-h-full w-full max-w-[360px] flex-col overflow-hidden rounded-3xl bg-[#f6efdd] shadow-2xl ring-1 ring-black/10">
        {/* header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-500/80">One More Thing</div>
            <div className="text-lg font-black leading-tight text-[#2f2540]">All objects</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-white/70 text-sm font-black text-[#2f2540] ring-1 ring-black/5 transition-transform hover:scale-105 active:scale-95"
          >
            ✕
          </button>
        </div>

        {/* scrollable grid */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
          {DIFFICULTY_ORDER.map((tier) => (
            <div key={tier} className="mb-3">
              <div
                className="mb-1.5 text-[10px] font-black uppercase tracking-[0.18em]"
                style={{ color: CATEGORY_HEX[tier] }}
              >
                {CATEGORY_LABEL[tier]}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {objectsByTier(tier).map((def) => (
                  <CatalogCell key={def.id} def={def} active={sel?.id === def.id} onSelect={setSel} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* detail footer — shows the tapped object's name + description */}
        <div className="border-t border-black/10 bg-white/40 px-4 py-3">
          {sel ? (
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center">
                <ObjectIcon def={sel} size={40} />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black text-[#2f2540]">{sel.name}</span>
                  <span
                    className="text-[8px] font-black uppercase tracking-[0.12em]"
                    style={{ color: CATEGORY_HEX[sel.difficulty] }}
                  >
                    {CATEGORY_LABEL[sel.difficulty]}
                  </span>
                </div>
                <div className="text-[11px] font-medium leading-snug text-[#6f6580]">{sel.blurb}</div>
              </div>
            </div>
          ) : (
            <div className="text-center text-[11px] font-semibold text-[#6f6580]">Tap an object to see its name and details.</div>
          )}
        </div>
      </div>
    </div>
  );
};

// ---- the game shell --------------------------------------------------------

const Game = () => {
  const mountRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<Phaser.Events.EventEmitter | null>(null);

  const [phase, setPhase] = useState<Phase>('LOADING');
  const [choices, setChoices] = useState<Choice[]>([]);
  const [count, setCount] = useState(0);
  const [hint, setHint] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ success: boolean } | null>(null);
  const [showIntro, setShowIntro] = useState<boolean>(() => !introSeen());
  const [showCatalog, setShowCatalog] = useState(false);

  const dismissIntro = () => {
    setShowIntro(false);
    try {
      localStorage.setItem(INTRO_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    let game: Phaser.Game | null = null;
    let disposed = false;
    const bridge = new Phaser.Events.EventEmitter();
    bridgeRef.current = bridge;

    bridge.on('phase', (p: Phase) => {
      setPhase(p);
      if (p === 'CHOOSING') {
        setSelectedId(null);
        setBanner(null);
      }
    });
    bridge.on('choices', (c: Choice[]) => setChoices(c));
    bridge.on('count', (n: number) => setCount(n));
    bridge.on('hint', (show: boolean) => setHint(show));
    bridge.on('result', (r: { success: boolean }) => setBanner(r));

    // Start every session on a clean, empty ground. (Saved community bodies are
    // not loaded here yet — placements don't persist until the backend commit is
    // wired, so any stored seed object would just appear as clutter on Enter.)
    const bodies: PersistedBodyState[] = [];
    if (!disposed && mountRef.current) {
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: mountRef.current,
        backgroundColor: '#f6efdd',
        scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
        // Sleeping is OFF: the hovering object is held perfectly still while the
        // player aims, and a sleeping body won't wake from the gentle drop nudge —
        // it would just hang in the air and be judged a collapse. Only one dynamic
        // body exists at a time (the tower is static), so there's no cost.
        physics: { default: 'matter', matter: { gravity: { x: 0, y: 1 }, enableSleeping: false } },
        input: { activePointers: 2 },
      });
      game.scene.add('tower', TowerScene, true, { bridge, bodies });
    }

    return () => {
      disposed = true;
      bridge.removeAllListeners();
      game?.destroy(true);
    };
  }, []);

  const send = (event: string, payload?: unknown) => bridgeRef.current?.emit(event, payload);

  const onPick = (id: string) => {
    if (selectedId) return;
    setSelectedId(id);
    // Let the pressed/fade animation read before the scene reframes.
    window.setTimeout(() => send('select', { id }), 140);
  };

  const showTray = phase === 'CHOOSING';
  const showControls = phase === 'PLACING';
  const holding = phase === 'DROPPING' || phase === 'CHECKING';

  return (
    <div
      className="fixed inset-0 flex touch-none justify-center overflow-hidden bg-[#f6efdd]"
      style={{ fontFamily: '"Baloo 2", "Nunito", system-ui, sans-serif' }}
    >
      {/* The centred physics stage (capped width on desktop, full width on mobile). */}
      <div className="relative h-full w-full max-w-[1100px]">
        {/* Phaser canvas */}
        <div ref={mountRef} className="absolute inset-0" />

        {/* First-run walkthrough. */}
        {showIntro && <HowToPlay onClose={dismissIntro} />}

        {/* Object catalog. */}
        {showCatalog && <Catalog onClose={() => setShowCatalog(false)} />}

        {/* HTML/CSS overlay — pointer-events pass through except on controls. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between px-3 pt-3 pb-0 sm:px-5 sm:pt-4 sm:pb-0">
          {/* Top bar — 3 equal columns so the logo is truly centred. */}
          <div className="grid grid-cols-3 items-center">
            <div className="flex items-center gap-1.5 justify-self-start">
              <button
                onClick={() => window.history.back()}
                aria-label="Back"
                className="pointer-events-auto flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white/70 shadow-sm ring-1 ring-black/5 transition-transform hover:-translate-x-0.5 active:scale-95"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#2f2540" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M15 5 L8 12 L15 19" />
                </svg>
              </button>
              <button
                onClick={() => setShowCatalog(true)}
                aria-label="All objects"
                className="pointer-events-auto flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white/70 shadow-sm ring-1 ring-black/5 transition-transform hover:-translate-y-0.5 active:scale-95"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="#2f2540" aria-hidden>
                  <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
                  <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
                  <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
                  <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
                </svg>
              </button>
            </div>
            <div className="justify-self-center">
              <Wordmark />
            </div>
            <div className="flex items-center gap-2 justify-self-end">
              <button
                onClick={() => setShowIntro(true)}
                aria-label="How to play"
                className="pointer-events-auto flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-white/70 text-sm font-black text-[#2f2540] shadow-sm ring-1 ring-black/5 transition-transform hover:-translate-y-0.5 active:scale-95"
              >
                ?
              </button>
              <div className="rounded-full bg-white/70 px-3 py-1 text-[11px] font-black text-[#2f2540] shadow-sm ring-1 ring-black/5">
                {count} {count === 1 ? 'object' : 'objects'}
              </div>
            </div>
          </div>

          {/* Center hint / banners */}
          <div className="flex flex-1 flex-col items-center justify-center gap-2">
            {hint && (
              <div className="mt-2 self-center rounded-full bg-[#2f2540]/85 px-3 py-1 text-[12px] font-bold text-white shadow-md">
                Drag to move
              </div>
            )}
            {banner && (
              <div className="flex flex-col items-center gap-1 text-center">
                <div
                  className="text-3xl font-black tracking-tight drop-shadow-sm sm:text-4xl"
                  style={{ color: banner.success ? '#e6a91e' : '#e8794a' }}
                >
                  {banner.success ? 'IT’S IN!' : 'NOT THIS TIME'}
                </div>
                {!banner.success && (
                  <div className="text-[12px] font-bold text-[#6f6580]">The last stable tower was restored.</div>
                )}
              </div>
            )}
          </div>

          {/* Bottom area — the tray/controls are pinned flush to the very
              bottom. Tray and controls share the same slot (controls overlay
              the tray) so the hidden one never reserves empty space below. */}
          <div className="flex flex-col items-center gap-2">
            {holding && (
              <div className="rounded-full bg-white/80 px-4 py-1.5 text-[12px] font-black text-[#2f2540] shadow-md ring-1 ring-black/5">
                Holding…
              </div>
            )}

            <div className="relative w-full">
              {/* Selection tray (reserves the slot height) */}
              <div
                className={`pointer-events-auto mx-auto flex w-full max-w-[400px] items-stretch gap-2 transition-all duration-300 ${
                  showTray ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0'
                }`}
              >
                {choices.map((c) => (
                  <ChoiceTile key={c.id} choice={c} selectedId={selectedId} onPick={onPick} />
                ))}
              </div>

              {/* Placement controls — overlay the same slot, anchored to the bottom */}
              <div
                className={`pointer-events-auto absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-[420px] items-center justify-center gap-4 transition-all duration-300 ${
                  showControls ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0'
                }`}
              >
                <RotateButton dir={-1} onRotate={(d) => send('rotate', { dir: d })} />
                <button
                  onClick={() => send('drop')}
                  className="flex h-14 flex-1 cursor-pointer items-center justify-center rounded-2xl border-b-[5px] border-[#d09a12] bg-[#f4c02c] text-xl font-black tracking-wide text-[#2f2540] shadow-lg shadow-yellow-900/15 transition-all duration-150 hover:brightness-[1.03] active:translate-y-[3px] active:border-b-2"
                >
                  DROP
                </button>
                <RotateButton dir={1} onRotate={(d) => send('rotate', { dir: d })} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<Game />);
