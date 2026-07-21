/* eslint-disable react-refresh/only-export-components -- single-entry game bundle, not a fast-refresh module */
import './index.css';

import Phaser from 'phaser';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CATEGORY_POINTS,
  DIFFICULTY_ORDER,
  getObjectDef,
  objectsByTier,
  type GameObjectDef,
} from '../shared/objects';
import type { PersistedBodyState } from '../shared/types';
import { objectArtUrl } from './objectArt';
import { nextUtcMidnight } from '../shared/post';
import { CATEGORY_HEX, CATEGORY_LABEL, objectIconSvg, type Choice } from './phaser/gameObjects';
import { TowerScene, type Phase } from './phaser/TowerScene';
import { addScore, fetchBuildState, fetchMe, fetchPointsBoard, placeBody } from './state/api';
import type { PlacedBody } from '../shared/api';

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
      <span
        className="rounded-full px-1.5 py-[1px] text-[8px] font-black text-white shadow-sm"
        style={{ backgroundColor: accent }}
      >
        +{CATEGORY_POINTS[choice.category]}
      </span>
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
      <span
        className="rounded-full px-1.5 py-[1px] text-[8px] font-black text-white"
        style={{ backgroundColor: CATEGORY_HEX[def.difficulty] }}
      >
        +{CATEGORY_POINTS[def.difficulty]}
      </span>
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

// ---- score, quota + leaderboard --------------------------------------------

const MAX_DROPS_PER_DAY = 3;

const SCORE_KEY = 'omt-score'; // offline fallback for the all-time total
const DAILY_KEY = 'omt-daily'; // offline fallback for the daily drop quota

const loadScore = (): number => {
  try {
    return Math.max(0, Number(localStorage.getItem(SCORE_KEY)) || 0);
  } catch {
    return 0;
  }
};

const saveScore = (n: number): void => {
  try {
    localStorage.setItem(SCORE_KEY, String(n));
  } catch {
    /* ignore */
  }
};

/** The current UTC day key — the Reddit-aligned daily boundary (00:00 UTC). */
const utcDayKey = (now: number): string => new Date(now).toISOString().slice(0, 10);

/** Offline drop-quota fallback: how many drops the account has used today. */
const loadDailyUsed = (now: number): number => {
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    if (!raw) return 0;
    const rec = JSON.parse(raw) as { dayKey?: string; count?: number };
    return rec.dayKey === utcDayKey(now) ? Math.max(0, Number(rec.count) || 0) : 0;
  } catch {
    return 0;
  }
};

const saveDailyUsed = (now: number, count: number): void => {
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify({ dayKey: utcDayKey(now), count }));
  } catch {
    /* ignore */
  }
};

/** "5h 03m 12s" — the time remaining until the daily reset. */
const formatCountdown = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
};

/** A ticking clock (epoch ms), updated every `intervalMs`, for live countdowns. */
const useNow = (intervalMs = 1000): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
};

type LeaderRow = { username: string; score: number; isViewer: boolean };

const RANK_BADGE = ['🥇', '🥈', '🥉'];

/** The tappable HUD tally — trophy + all-time score, pops when it grows. */
const ScorePill = ({ score, pop, onClick }: { score: number; pop: boolean; onClick: () => void }) => (
  <button
    onClick={onClick}
    aria-label="Leaderboard"
    className={`pointer-events-auto flex items-center gap-1 rounded-full bg-[#2f2540] px-3 py-1 text-[12px] font-black text-[#f4c02c] shadow-md ring-1 ring-black/10 transition-transform duration-200 hover:-translate-y-0.5 active:scale-95 ${
      pop ? 'scale-125' : 'scale-100'
    }`}
  >
    <span className="text-[13px] leading-none">🏆</span>
    <span className="tabular-nums text-white">{score.toLocaleString()}</span>
  </button>
);

/** One tidy status chip: today's drops + the daily-reset countdown. */
const StatusBar = ({
  dropsRemaining,
  msLeft,
  locked,
}: {
  dropsRemaining: number;
  msLeft: number;
  locked: boolean;
}) => (
  <div
    className={`pointer-events-none flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black shadow-sm ring-1 ring-black/5 ${
      locked ? 'bg-[#e8794a] text-white' : 'bg-white/75 text-[#2f2540]'
    }`}
  >
    <span className="flex items-center gap-1">
      🧱 <span className="tabular-nums">{dropsRemaining}/{MAX_DROPS_PER_DAY}</span>
      <span className="opacity-70">drops</span>
    </span>
    <span className="opacity-25">•</span>
    <span className="flex items-center gap-1">
      ⏳ <span className="tabular-nums">{formatCountdown(msLeft)}</span>
    </span>
  </div>
);

const LeaderRowView = ({ row, rank }: { row: LeaderRow; rank: number }) => {
  const medal = RANK_BADGE[rank - 1];
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl px-3 py-2 ring-1 transition-colors ${
        row.isViewer ? 'bg-[#f4c02c]/25 ring-[#e0a90f]/50' : 'bg-white/70 ring-black/5'
      }`}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black ${
          medal ? 'bg-transparent' : 'bg-[#2f2540]/8 text-[#6f6580]'
        }`}
      >
        {medal ?? rank}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-black text-[#2f2540]">u/{row.username}</span>
          {row.isViewer && (
            <span className="rounded-full bg-[#e0a90f] px-1.5 py-[1px] text-[8px] font-black uppercase tracking-wide text-white">
              You
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0 tabular-nums text-[14px] font-black text-[#2f2540]">
        {row.score.toLocaleString()}
      </div>
    </div>
  );
};

/**
 * The permanent, all-time leaderboard — real Reddit players by lifetime points.
 * Polls the server every few seconds while open so new scores appear live.
 */
const Leaderboard = ({
  score,
  username,
  msLeft,
  onClose,
}: {
  score: number;
  username: string;
  msLeft: number;
  onClose: () => void;
}) => {
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const res = await fetchPointsBoard(20);
      if (!alive) return;
      if ('entries' in res) {
        setRows(res.entries.map((e) => ({ username: e.username, score: e.value, isViewer: e.isViewer })));
      }
      setLoaded(true);
    };
    void load();
    const id = window.setInterval(() => void load(), 4000); // live refresh
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-[#2f2540]/45 px-4 py-6 backdrop-blur-[2px]">
      <div className="flex max-h-full w-full max-w-[360px] flex-col overflow-hidden rounded-3xl bg-[#f6efdd] shadow-2xl ring-1 ring-black/10">
        {/* header */}
        <div className="relative bg-gradient-to-br from-[#3a2e4d] to-[#2f2540] px-5 pt-5 pb-5 text-center">
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-white/15 text-sm font-black text-white transition-transform hover:scale-105 active:scale-95"
          >
            ✕
          </button>
          <div className="text-3xl">🏆</div>
          <div className="mt-1 text-xl font-black text-white">Leaderboard</div>
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#f4c02c]">
            All-time top builders
          </div>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[12px] font-black text-white">
            <span className="text-[#f4c02c]">Your points</span>
            <span className="tabular-nums">{score.toLocaleString()}</span>
          </div>
        </div>

        {/* rows */}
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-3">
          {rows.length > 0 ? (
            rows.map((row, i) => <LeaderRowView key={`${row.username}-${i}`} row={row} rank={i + 1} />)
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <div className="text-4xl">🧱</div>
              <div className="text-sm font-black text-[#2f2540]">
                {loaded ? 'No scores yet' : 'Loading…'}
              </div>
              {loaded && (
                <div className="text-[12px] font-semibold text-[#6f6580]">
                  Be the first — u/{username}, drop an object to claim the top spot!
                </div>
              )}
            </div>
          )}
        </div>

        {/* footer — points legend + daily reset countdown */}
        <div className="border-t border-black/10 bg-white/40 px-4 py-3 text-center">
          <div className="text-[11px] font-semibold text-[#6f6580]">
            Safe <span className="font-black text-[#2f8fd8]">+100</span> · Risky{' '}
            <span className="font-black text-[#e6a91e]">+250</span> · Absurd{' '}
            <span className="font-black text-[#e8794a]">+500</span>
          </div>
          <div className="mt-1 text-[11px] font-bold text-[#2f2540]">
            Next daily reset in <span className="tabular-nums text-[#e0a90f]">{formatCountdown(msLeft)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

/** Shown over the tray once the account has spent its 3 daily drops. */
const DailyLock = ({ msLeft }: { msLeft: number }) => (
  <div className="pointer-events-auto mx-auto flex w-full max-w-[400px] flex-col items-center gap-1 rounded-2xl bg-[#2f2540] px-4 py-3 text-center shadow-lg ring-1 ring-black/10">
    <div className="text-[13px] font-black text-white">Daily drops used 🎉</div>
    <div className="text-[11px] font-semibold text-[#d8cfe6]">
      You’ve placed all {MAX_DROPS_PER_DAY} of today’s objects. Come back tomorrow!
    </div>
    <div className="mt-0.5 rounded-full bg-white/10 px-3 py-1 text-[12px] font-black text-[#f4c02c]">
      Resets in <span className="tabular-nums">{formatCountdown(msLeft)}</span>
    </div>
  </div>
);

// ---- the game shell --------------------------------------------------------

const Game = () => {
  const mountRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<Phaser.Events.EventEmitter | null>(null);

  const [phase, setPhase] = useState<Phase>('LOADING');
  const [choices, setChoices] = useState<Choice[]>([]);
  const [hint, setHint] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ success: boolean } | null>(null);
  const [showIntro, setShowIntro] = useState<boolean>(() => !introSeen());
  const [showCatalog, setShowCatalog] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [score, setScore] = useState<number>(loadScore);
  const [scorePop, setScorePop] = useState(false);
  const [username, setUsername] = useState<string>('you');
  // The drop quota, tagged with the UTC day it belongs to. Reading it against
  // the live clock's day makes the daily reset automatic: once the day rolls
  // over, the stored count no longer applies and the quota shows full again — no
  // timer effect needed.
  const [drops, setDrops] = useState<{ dayKey: string; remaining: number }>(() => {
    const ts = Date.now();
    return { dayKey: utcDayKey(ts), remaining: Math.max(0, MAX_DROPS_PER_DAY - loadDailyUsed(ts)) };
  });

  const now = useNow(1000);
  const today = utcDayKey(now);
  const msLeft = Math.max(0, nextUtcMidnight(now) - now);
  // Effective remaining drops: full again on a new UTC day.
  const dropsRemaining = drops.dayKey === today ? drops.remaining : MAX_DROPS_PER_DAY;
  const locked = dropsRemaining <= 0;

  // Real Reddit identity + authoritative standing. Falls back silently offline.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const me = await fetchMe();
      if (!alive || !('username' in me)) return;
      setUsername(me.username);
      setScore(me.score);
      saveScore(me.score);
      setDrops({ dayKey: utcDayKey(me.now), remaining: me.dropsRemaining });
    })();
    return () => {
      alive = false;
    };
  }, []);

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
    bridge.on('hint', (show: boolean) => setHint(show));
    bridge.on('result', (r: { success: boolean }) => setBanner(r));
    // Every RESOLVED drop — success or collapse — spends one of today's drops.
    // A success additionally awards points (pulsing the HUD) and persists the
    // settled body to the shared tower so the build survives reloads/deploys.
    // The server is authoritative; offline, the local fallbacks stay consistent.
    bridge.on('resolved', (d: { success: boolean; points: number; body?: PlacedBody }) => {
      if (!d) return; // ignore stray emits
      const ts = Date.now();
      const dayKey = utcDayKey(ts);

      // Spend a daily drop (both outcomes).
      setDrops((prev) => {
        const base = prev.dayKey === dayKey ? prev.remaining : MAX_DROPS_PER_DAY;
        const remaining = Math.max(0, base - 1);
        saveDailyUsed(ts, MAX_DROPS_PER_DAY - remaining);
        return { dayKey, remaining };
      });

      if (d.success) {
        // Optimistic points + pop.
        setScore((prev) => {
          const next = prev + d.points;
          saveScore(next);
          return next;
        });
        setScorePop(true);
        window.setTimeout(() => setScorePop(false), 260);
        // Persist the body to the shared tower (best-effort; failure is non-fatal).
        if (d.body) void placeBody(d.body);
      }

      // Record the drop on the server (points is 0 for a failed drop, which still
      // counts). Reconcile the authoritative all-time total + remaining quota.
      void (async () => {
        const res = await addScore(d.points);
        if (!('score' in res)) return; // offline / error → keep optimistic values
        setScore(res.score);
        saveScore(res.score);
        setDrops({ dayKey: utcDayKey(ts), remaining: res.dropsRemaining });
        saveDailyUsed(ts, MAX_DROPS_PER_DAY - res.dropsRemaining);
      })();
    });

    // Load the PERSISTED shared tower first, so the community build the player
    // saw last time is still standing (it survives reloads and production
    // deploys — Redis data is never wiped by a code push). Offline, this falls
    // back to an empty ground.
    void (async () => {
      const res = await fetchBuildState();
      const placed = 'bodies' in res ? res.bodies : [];
      const bodies: PersistedBodyState[] = placed.map((b, i) => ({
        bodyId: `saved-${i + 1}`,
        objectId: b.objectId,
        ownerUserId: '',
        ownerUsername: '',
        sequenceNumber: i + 1,
        x: b.x,
        y: b.y,
        angle: b.angle,
        scaleX: b.scaleX,
        scaleY: b.scaleY,
      }));
      if (disposed || !mountRef.current) return;
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
    })();

    return () => {
      disposed = true;
      bridge.removeAllListeners();
      game?.destroy(true);
    };
  }, []);

  const send = (event: string, payload?: unknown) => bridgeRef.current?.emit(event, payload);

  const onPick = (id: string) => {
    if (selectedId || locked) return; // daily quota spent → no new placements
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

        {/* Leaderboard. */}
        {showLeaderboard && (
          <Leaderboard
            score={score}
            username={username}
            msLeft={msLeft}
            onClose={() => setShowLeaderboard(false)}
          />
        )}

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
              <ScorePill score={score} pop={scorePop} onClick={() => setShowLeaderboard(true)} />
            </div>
          </div>

          {/* Daily status — drops + reset countdown, kept as one tidy chip. */}
          <div className="mt-2 flex justify-center">
            <StatusBar dropsRemaining={dropsRemaining} msLeft={msLeft} locked={locked} />
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
              {/* Daily quota spent → lock the tray with a countdown to reset. */}
              {locked && showTray ? (
                <DailyLock msLeft={msLeft} />
              ) : (
                /* Selection tray (reserves the slot height) */
                <div
                  className={`pointer-events-auto mx-auto flex w-full max-w-[400px] items-stretch gap-2 transition-all duration-300 ${
                    showTray ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0'
                  }`}
                >
                  {choices.map((c) => (
                    <ChoiceTile key={c.id} choice={c} selectedId={selectedId} onPick={onPick} />
                  ))}
                </div>
              )}

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
