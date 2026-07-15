import './index.css';

import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Phaser from 'phaser';
import type { ObjectChoice, PlayerDailyState, TowerState } from '../shared/types';
import { getObjectDef } from '../shared/objects';
import { createGame } from './phaser/boot';
import { GameBridge, type ScenePhase, type SettleResult } from './phaser/bridge';
import { STABILITY_LABEL_TEXT, type StabilityLabel } from './phaser/stability';
import {
  commitPlacement,
  failAttempt,
  fetchBootstrap,
  startAttempt,
} from './state/api';
import {
  canStartAttempt,
  contributionStatus,
  dailyTitle,
  deriveLaunchState,
  formatCountdown,
  formatPlacedAt,
  formatScore,
  inspectionModel,
  towerIsEmpty,
  towerStats,
  type InspectionModel,
  type LaunchState,
} from './state/launchView';

type UiPhase =
  | 'loading'
  | 'error'
  | 'idle'
  | 'selecting'
  | 'placing'
  | 'evaluating'
  | 'success'
  | 'collapse';

type AttemptCtx = {
  attemptId: string;
  baseTowerVersion: number;
  objectId: string;
  newBodyId: string;
  /** One key per attempt, reused across conflict-repositions and timeout
   *  retries so a re-sent commit is deduplicated server-side (Task 9). */
  idempotencyKey: string;
};

type ResultInfo = {
  objectName: string;
  sequenceNumber: number;
  score: number;
  contributors: number;
};

const DIFFICULTY_STYLE: Record<string, string> = {
  safe: 'border-emerald-400/60 text-emerald-300',
  risky: 'border-amber-400/60 text-amber-300',
  absurd: 'border-rose-400/60 text-rose-300',
};

export const App = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const bridgeRef = useRef<GameBridge | null>(null);
  const towerRef = useRef<TowerState | null>(null);
  const attemptRef = useRef<AttemptCtx | null>(null);
  const sceneReadyRef = useRef(false);
  const localUserRef = useRef<string | null>(null);

  const [uiPhase, setUiPhase] = useState<UiPhase>('loading');
  const [scenePhase, setScenePhase] = useState<ScenePhase>('idle');
  const [tower, setTower] = useState<TowerState | null>(null);
  const [player, setPlayer] = useState<PlayerDailyState | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [choices, setChoices] = useState<ObjectChoice[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ResultInfo | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [readOnly, setReadOnly] = useState(false);
  const [errorKind, setErrorKind] = useState<'network' | 'redis' | null>(null);
  const [stabilityLabel, setStabilityLabel] = useState<StabilityLabel>('hold');
  const [inspectBodyId, setInspectBodyId] = useState<string | null>(null);
  const [howItWorks, setHowItWorks] = useState(false);

  // Countdown ticker. setState lives in the interval callback, not the effect body.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const applyTower = useCallback((next: TowerState) => {
    towerRef.current = next;
    setTower(next);
    if (sceneReadyRef.current) bridgeRef.current?.loadTower(next);
  }, []);

  const clearInspection = useCallback(() => {
    setInspectBodyId(null);
    bridgeRef.current?.highlightBody(null);
  }, []);

  const handleSettle = useCallback(async (settle: SettleResult) => {
    const attempt = attemptRef.current;
    const bridge = bridgeRef.current;
    if (!attempt || !bridge) return;

    if (!settle.stable) {
      // The scene has already restored the pre-attempt tower locally; we only
      // record the failed attempt and show the humorous message.
      const res = await failAttempt(attempt.attemptId);
      if ('type' in res) setPlayer(res.player);
      setMessage(settle.message ?? 'The tower respectfully declined.');
      setUiPhase('collapse');
      return;
    }

    setUiPhase('evaluating');
    // Stable per-attempt key: a timeout retry re-sends the same key so the
    // server returns the original placement rather than committing twice.
    const res = await commitPlacement({
      attemptId: attempt.attemptId,
      idempotencyKey: attempt.idempotencyKey,
      selectedObjectId: settle.selectedObjectId,
      baseTowerVersion: settle.baseTowerVersion,
      newBodyId: settle.newBodyId,
      bodies: settle.bodies,
    });

    if ('type' in res) {
      applyTower(res.tower);
      setPlayer(res.player);
      const def = getObjectDef(settle.selectedObjectId);
      setResult({
        objectName: def?.name ?? 'object',
        sequenceNumber: res.sequenceNumber,
        score: res.score,
        contributors: res.tower.meta.uniqueContributors,
      });
      setMessage(null);
      setUiPhase('success');
      return;
    }

    if (res.status === 'conflict') {
      applyTower(res.tower);
      setPlayer(res.player);
      attemptRef.current = {
        ...attempt,
        baseTowerVersion: res.tower.meta.version,
      };
      setMessage(res.message);
      bridge.beginPlacement(attempt.objectId, attempt.newBodyId, res.tower.meta.version);
      setUiPhase('placing');
      return;
    }

    // Storage failure: never claim success; drop to read-only.
    if (res.code === 'redis-error') {
      setReadOnly(true);
      setMessage(res.message);
      if (towerRef.current) bridge.loadTower(towerRef.current);
      setUiPhase('idle');
      return;
    }

    // Error path.
    if (
      res.code === 'already-succeeded' ||
      res.code === 'no-attempts' ||
      res.code === 'attempt-expired'
    ) {
      setMessage(res.message);
      if (towerRef.current) bridge.loadTower(towerRef.current);
      setUiPhase('idle');
      return;
    }
    // Recoverable (e.g. transient validation) — let the player reposition.
    setMessage(res.message);
    if (towerRef.current) bridge.loadTower(towerRef.current);
    bridge.beginPlacement(attempt.objectId, attempt.newBodyId, attempt.baseTowerVersion);
    setUiPhase('placing');
  }, [applyTower]);

  // Boot Phaser + bridge once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const bridge = new GameBridge();
    bridgeRef.current = bridge;
    bridge.onReady = () => {
      sceneReadyRef.current = true;
      bridge.setLocalUser(localUserRef.current);
      if (towerRef.current) bridge.loadTower(towerRef.current);
    };
    bridge.onPhaseChange = (phase) => setScenePhase(phase);
    bridge.onStabilityLabel = (label) => setStabilityLabel(label);
    bridge.onInspect = (bodyId) => setInspectBodyId(bodyId);
    bridge.onSettle = (settle) => {
      void handleSettle(settle);
    };

    const game = createGame(container, bridge);
    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
      bridgeRef.current = null;
      sceneReadyRef.current = false;
    };
  }, [handleSettle]);

  const loadTowerData = useCallback(async () => {
    const res = await fetchBootstrap();
    if ('type' in res) {
      localUserRef.current = res.userId;
      bridgeRef.current?.setLocalUser(res.userId);
      setUserId(res.userId);
      setPlayer(res.player);
      setReadOnly(res.readOnly);
      setErrorKind(null);
      applyTower(res.tower);
      setUiPhase('idle');
    } else {
      setErrorKind(res.code === 'redis-error' ? 'redis' : 'network');
      setMessage(res.message);
      setUiPhase('error');
    }
  }, [applyTower]);

  // Initial data load.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!cancelled) await loadTowerData();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadTowerData]);

  const onAddOneMore = useCallback(async () => {
    setMessage(null);
    clearInspection();
    const res = await startAttempt();
    if ('type' in res) {
      attemptRef.current = {
        attemptId: res.attemptId,
        baseTowerVersion: res.baseTowerVersion,
        objectId: '',
        newBodyId: '',
        idempotencyKey: crypto.randomUUID(),
      };
      setChoices(res.choices);
      setPlayer(res.player);
      setUiPhase('selecting');
    } else {
      if (res.code === 'redis-error') setReadOnly(true);
      setMessage(res.message);
    }
  }, [clearInspection]);

  const onChoose = useCallback((choice: ObjectChoice) => {
    const attempt = attemptRef.current;
    const bridge = bridgeRef.current;
    if (!attempt || !bridge) return;
    const newBodyId = crypto.randomUUID();
    attemptRef.current = { ...attempt, objectId: choice.objectId, newBodyId };
    bridge.beginPlacement(choice.objectId, newBodyId, attempt.baseTowerVersion);
    setUiPhase('placing');
  }, []);

  const onRotate = useCallback((dir: -1 | 1) => bridgeRef.current?.rotate(dir), []);
  const onDrop = useCallback(() => bridgeRef.current?.drop(), []);

  const launchState = deriveLaunchState({
    loading: uiPhase === 'loading',
    errorCode: uiPhase === 'error' ? errorKind : null,
    readOnly,
    authenticated: userId !== null,
    player,
    towerStatus: tower?.meta.status ?? null,
  });

  const isLaunchPhase = uiPhase === 'idle' || uiPhase === 'loading' || uiPhase === 'error';
  const countdown = tower ? formatCountdown(tower.meta.endsAt - now) : '';
  const inspection =
    inspectBodyId && tower ? inspectionModel(inspectBodyId, tower, userId) : null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#181a20] text-slate-100 select-none">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Hero header — daily title + live stats + countdown. Compact so the
          tower stays the visual hero. Stacks tighter on mobile. */}
      {tower && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2 sm:p-3">
          <div className="pointer-events-auto rounded-xl bg-black/45 px-3 py-2 backdrop-blur-sm">
            <div className="text-[13px] font-semibold tracking-wide text-amber-200 sm:text-sm">
              ONE MORE THING
            </div>
            <div className="text-[10px] text-slate-400">{dailyTitle(tower)}</div>
            <div className="mt-1 flex gap-3">
              {towerStats(tower).map((s) => (
                <div key={s.key} className="leading-none">
                  <div className="text-sm font-bold text-slate-100 sm:text-base">{s.value}</div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-400">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="pointer-events-auto rounded-xl bg-black/45 px-3 py-2 text-right backdrop-blur-sm">
            <div className="text-[9px] uppercase tracking-widest text-slate-400">Closes in</div>
            <div className="text-sm font-semibold text-slate-100">{countdown}</div>
          </div>
        </div>
      )}

      {/* Inspection card — appears when an accepted body is tapped. */}
      {inspection && (
        <InspectionCard inspection={inspection} now={now} onClose={clearInspection} />
      )}

      {/* Bottom control zone */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-3 sm:p-4">
        {message && (
          <div className="pointer-events-auto max-w-sm rounded-lg bg-black/60 px-4 py-2 text-center text-sm text-amber-100 backdrop-blur-sm">
            {message}
          </div>
        )}

        {isLaunchPhase && (
          <LaunchPanel
            state={launchState}
            player={player}
            emptyTower={tower ? towerIsEmpty(tower) : false}
            onAdd={onAddOneMore}
            onHowItWorks={() => setHowItWorks(true)}
            onRetry={() => {
              setUiPhase('loading');
              void loadTowerData();
            }}
          />
        )}

        {uiPhase === 'selecting' && (
          <SelectionPanel choices={choices} onChoose={onChoose} />
        )}

        {uiPhase === 'placing' && scenePhase === 'placing' && (
          <PlacementControls onRotate={onRotate} onDrop={onDrop} armed />
        )}

        {scenePhase === 'settling' && uiPhase !== 'evaluating' && (
          <div className="pointer-events-auto rounded-lg bg-black/55 px-6 py-2 text-lg font-bold text-slate-100">
            {STABILITY_LABEL_TEXT[stabilityLabel]}
          </div>
        )}

        {uiPhase === 'evaluating' && (
          <div className="pointer-events-auto rounded-lg bg-black/55 px-5 py-2 text-lg font-bold text-emerald-300">
            {STABILITY_LABEL_TEXT.locked} <span className="text-sm font-medium text-slate-300">saving…</span>
          </div>
        )}

        {uiPhase === 'success' && result && (
          <ResultPanel
            title="It stays!"
            accent="text-emerald-300"
            lines={[
              `You added object #${result.sequenceNumber}: ${result.objectName}.`,
              `+${result.score} points · ${result.contributors} builders so far.`,
              'Come back before the tower closes to see what gets built above you.',
            ]}
            primaryLabel="Inspect the tower"
            onPrimary={() => setUiPhase('idle')}
          />
        )}

        {uiPhase === 'collapse' && (
          <ResultPanel
            title="Collapse!"
            accent="text-rose-300"
            lines={[
              'Good news: the last stable version survived.',
              player
                ? `${player.attemptsRemaining} attempt${player.attemptsRemaining === 1 ? '' : 's'} left today.`
                : '',
            ]}
            primaryLabel={
              player && player.attemptsRemaining > 0 ? 'Try again' : 'Back to tower'
            }
            onPrimary={() => {
              if (player && player.attemptsRemaining > 0) void onAddOneMore();
              else setUiPhase('idle');
            }}
          />
        )}
      </div>

      {howItWorks && <HowItWorks onClose={() => setHowItWorks(false)} />}
    </div>
  );
};

// ---- launch screen ---------------------------------------------------------

const LaunchPanel = ({
  state,
  player,
  emptyTower,
  onAdd,
  onHowItWorks,
  onRetry,
}: {
  state: LaunchState;
  player: PlayerDailyState | null;
  emptyTower: boolean;
  onAdd: () => void;
  onHowItWorks: () => void;
  onRetry: () => void;
}) => {
  if (state === 'loading') return <LoadingSkeleton />;

  if (state === 'network-error' || state === 'redis-error') {
    const redis = state === 'redis-error';
    return (
      <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-3 rounded-2xl bg-black/70 px-5 py-4 text-center backdrop-blur-md">
        <div className="text-lg font-black text-rose-300">
          {redis ? 'Storage is unavailable' : 'Connection problem'}
        </div>
        <p className="text-[12px] leading-snug text-slate-300">
          {redis
            ? 'The tower’s storage is temporarily unreachable. Nothing you did was lost.'
            : 'We couldn’t reach the server. Check your connection and try again.'}
        </p>
        <button
          onClick={onRetry}
          className="rounded-full bg-orange-500 px-6 py-2 text-sm font-bold text-white hover:bg-orange-400"
        >
          Try again
        </button>
      </div>
    );
  }

  const note = contributionStatus(state, player);

  return (
    <div className="pointer-events-auto flex w-full max-w-sm flex-col items-center gap-2">
      <p className="max-w-xs text-center text-[12px] leading-snug text-slate-300">
        {emptyTower
          ? 'Nobody has placed anything yet. Set the foundation for today’s tower.'
          : 'Everyone builds the same tower. Add one object — if it stays, it becomes the next player’s problem.'}
      </p>

      {state === 'read-only' && (
        <div className="rounded-lg bg-amber-900/50 px-4 py-2 text-center text-xs text-amber-200">
          Read-only — saving is temporarily unavailable. You can still watch and inspect the tower.
        </div>
      )}
      {state === 'finalized' && (
        <div className="rounded-lg bg-slate-800/70 px-4 py-2 text-center text-xs text-slate-200">
          This tower is finalized. Explore what the community built, or watch for the next one.
        </div>
      )}
      {state === 'unauthenticated' && (
        <div className="rounded-lg bg-black/55 px-4 py-2 text-center text-xs text-slate-300">
          Open this post in the Reddit app and sign in to add your object. You can still inspect it.
        </div>
      )}
      {state === 'contributed' && (
        <div className="rounded-lg bg-black/55 px-4 py-2 text-center text-xs text-emerald-200">
          Your object is in today’s tower. Come back to see what stacks above it.
        </div>
      )}

      {(state === 'ready' || state === 'no-attempts') && (
        <button
          onClick={onAdd}
          disabled={!canStartAttempt(state)}
          className="w-full rounded-full bg-orange-500 px-8 py-3.5 text-lg font-black tracking-wide text-white shadow-lg transition-colors hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-40 sm:text-xl"
        >
          ADD ONE MORE THING
        </button>
      )}

      {note && <div className="text-[11px] text-slate-400">{note}</div>}

      <button
        onClick={onHowItWorks}
        className="rounded-full px-4 py-1 text-[11px] font-semibold uppercase tracking-widest text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
      >
        How it works
      </button>
    </div>
  );
};

const LoadingSkeleton = () => (
  <div className="pointer-events-auto flex w-full max-w-sm animate-pulse flex-col items-center gap-3">
    <div className="h-3 w-56 rounded bg-slate-600/50" />
    <div className="h-12 w-full max-w-xs rounded-full bg-slate-600/40" />
    <div className="h-2.5 w-28 rounded bg-slate-600/40" />
    <div className="mt-1 text-[11px] text-slate-500">Loading the community tower…</div>
  </div>
);

const InspectionCard = ({
  inspection,
  now,
  onClose,
}: {
  inspection: InspectionModel;
  now: number;
  onClose: () => void;
}) => (
  <div className="pointer-events-auto absolute left-1/2 top-1/2 w-64 max-w-[80vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-black/80 px-4 py-3 backdrop-blur-md">
    <div className="flex items-start justify-between gap-2">
      <div className="text-base font-bold text-slate-100">{inspection.objectName}</div>
      <button
        onClick={onClose}
        aria-label="Close"
        className="-mr-1 -mt-1 rounded-full px-2 text-lg leading-none text-slate-400 hover:text-slate-100"
      >
        ×
      </button>
    </div>
    {inspection.isOwn && (
      <div className="mt-0.5 inline-block rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
        ★ Your object
      </div>
    )}
    <div className="mt-2 space-y-1 text-[12px]">
      <InspectRow label="Placed by" value={`u/${inspection.contributor}`} />
      <InspectRow label="Object #" value={String(inspection.sequenceNumber)} />
      <InspectRow
        label="Difficulty"
        value={inspection.difficulty}
        valueClass={DIFFICULTY_STYLE[inspection.difficulty]?.split(' ').pop()}
      />
      <InspectRow label="Score" value={formatScore(inspection.score)} />
      <InspectRow label="Placed" value={formatPlacedAt(inspection.placedAt, now)} />
      <InspectRow
        label="Built on top"
        value={
          inspection.laterAdditions === 0
            ? 'nothing yet'
            : `${inspection.laterAdditions} object${inspection.laterAdditions === 1 ? '' : 's'}`
        }
      />
    </div>
  </div>
);

const InspectRow = ({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string | undefined;
}) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className="text-slate-400">{label}</span>
    <span className={`font-medium text-slate-100 ${valueClass ?? ''}`}>{value}</span>
  </div>
);

const HowItWorks = ({ onClose }: { onClose: () => void }) => (
  <div
    className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    onClick={onClose}
  >
    <div
      className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#20232c] px-5 py-5"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-lg font-black text-amber-200">How it works</div>
      <ol className="mt-3 space-y-2.5 text-[13px] leading-snug text-slate-200">
        <li>
          <span className="font-bold text-slate-100">1. One shared tower.</span> Everyone who
          opens this post builds the same daily tower.
        </li>
        <li>
          <span className="font-bold text-slate-100">2. Add one thing.</span> You get three object
          choices and three attempts. Drop your object so it settles and stays.
        </li>
        <li>
          <span className="font-bold text-slate-100">3. It becomes the challenge.</span> If it
          holds, it’s saved and the next player has to build on top of it.
        </li>
      </ol>
      <p className="mt-3 text-[11px] text-slate-400">
        Tap any object in the tower to see who placed it and when.
      </p>
      <button
        onClick={onClose}
        className="mt-4 w-full rounded-full bg-orange-500 px-6 py-2 text-sm font-bold text-white hover:bg-orange-400"
      >
        Got it
      </button>
    </div>
  </div>
);

// ---- attempt flow panels (unchanged behaviour) -----------------------------

const SelectionPanel = ({
  choices,
  onChoose,
}: {
  choices: ObjectChoice[];
  onChoose: (c: ObjectChoice) => void;
}) => (
  <div className="pointer-events-auto flex flex-col items-center gap-2">
    <div className="text-xs uppercase tracking-widest text-slate-400">Choose one</div>
    <div className="flex gap-2">
      {choices.map((c) => (
        <button
          key={c.objectId}
          onClick={() => onChoose(c)}
          className={`w-24 rounded-xl border-2 bg-black/50 px-2 py-3 text-center backdrop-blur-sm transition-transform hover:scale-105 ${
            DIFFICULTY_STYLE[c.difficulty] ?? 'border-slate-500 text-slate-200'
          }`}
        >
          <div className="text-[13px] font-bold leading-tight text-slate-100">
            {c.name}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-wide">{c.difficulty}</div>
          <div className="mt-1 text-[11px] text-slate-300">{c.baseScore} pts</div>
        </button>
      ))}
    </div>
  </div>
);

const PlacementControls = ({
  onRotate,
  onDrop,
  armed,
}: {
  onRotate: (dir: -1 | 1) => void;
  onDrop: () => void;
  armed: boolean;
}) => (
  <div className="pointer-events-auto flex w-full max-w-sm flex-col items-center gap-2">
    <p className="text-[11px] text-slate-400">Drag to move · rotate · drop</p>
    <div className="flex w-full items-center justify-between gap-3">
      <button
        onClick={() => onRotate(-1)}
        className="h-14 w-14 rounded-full bg-slate-700/80 text-2xl font-bold text-white active:bg-slate-600"
        aria-label="Rotate left"
      >
        ⟲
      </button>
      <button
        onClick={onDrop}
        disabled={!armed}
        className="h-16 flex-1 rounded-2xl bg-orange-500 text-lg font-black tracking-wide text-white shadow-lg active:bg-orange-400 disabled:opacity-40"
      >
        DROP
      </button>
      <button
        onClick={() => onRotate(1)}
        className="h-14 w-14 rounded-full bg-slate-700/80 text-2xl font-bold text-white active:bg-slate-600"
        aria-label="Rotate right"
      >
        ⟳
      </button>
    </div>
  </div>
);

const ResultPanel = ({
  title,
  accent,
  lines,
  primaryLabel,
  onPrimary,
}: {
  title: string;
  accent: string;
  lines: string[];
  primaryLabel: string;
  onPrimary: () => void;
}) => (
  <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-2 rounded-2xl bg-black/65 px-5 py-4 text-center backdrop-blur-md">
    <div className={`text-xl font-black ${accent}`}>{title}</div>
    {lines.filter(Boolean).map((line, i) => (
      <p key={i} className="text-[12px] leading-snug text-slate-200">
        {line}
      </p>
    ))}
    <button
      onClick={onPrimary}
      className="mt-1 rounded-full bg-orange-500 px-6 py-2 text-sm font-bold text-white hover:bg-orange-400"
    >
      {primaryLabel}
    </button>
  </div>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
