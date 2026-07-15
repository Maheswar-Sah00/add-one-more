import './index.css';

import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Phaser from 'phaser';
import type { LeaderboardBoard, MilestoneInfo } from '../shared/api';
import type {
  ObjectChoice,
  PersistedBodyState,
  PlayerDailyState,
  TowerFinalSummary,
  TowerState,
} from '../shared/types';
import { OBJECT_LIBRARY, getObjectDef } from '../shared/objects';
import { currentMilestone, getMilestone } from '../shared/milestones';
import { getModifier, type DailyModifier } from '../shared/modifiers';
import { createGame } from './phaser/boot';
import { GameBridge, type ScenePhase, type SettleResult } from './phaser/bridge';
import { STABILITY_LABEL_TEXT, type StabilityLabel } from './phaser/stability';
import {
  commitPlacement,
  failAttempt,
  fetchArchive,
  fetchBootstrap,
  fetchLeaderboard,
  startAttempt,
} from './state/api';
import {
  canStartAttempt,
  contributionStatus,
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
import { initAudio, playMilestone, setAudioMuted } from './phaser/audio';
import {
  readMuted,
  readReducedMotionPref,
  writeMuted,
  writeReducedMotionPref,
} from './state/settings';
import { buildPreview, type ObjectPreview } from './state/objectPreview';
import {
  PRACTICE_BANNER,
  recordPractice,
  startPractice,
  type PracticeSession,
} from './state/practice';
import {
  initialSelection,
  isSelected,
  selectionCards,
  tapCard,
  type SelectionCard,
  type SelectionState,
} from './state/selection';
import {
  TUTORIAL_STEPS,
  clampStep,
  isLastStep,
  markTutorialSeen,
  shouldAutoShowTutorial,
} from './state/tutorial';

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
  safe: 'border-emerald-300 text-emerald-600',
  risky: 'border-amber-300 text-amber-600',
  absurd: 'border-rose-300 text-rose-600',
};

/** A player may keep contributing while they have both a placement slot and an
 *  attempt left (up to maxSuccessesPerDay objects per daily tower). */
function canAddAnother(player: PlayerDailyState | null): boolean {
  return player !== null && player.placementsRemaining > 0 && player.attemptsRemaining > 0;
}

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
  const [username, setUsername] = useState<string>('');
  const [choices, setChoices] = useState<ObjectChoice[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ResultInfo | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [readOnly, setReadOnly] = useState(false);
  const [errorKind, setErrorKind] = useState<'network' | 'redis' | null>(null);
  const [stabilityLabel, setStabilityLabel] = useState<StabilityLabel>('hold');
  const [inspectBodyId, setInspectBodyId] = useState<string | null>(null);
  const [milestone, setMilestone] = useState<MilestoneInfo | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [practice, setPractice] = useState<PracticeSession | null>(null);
  /** Read inside handleSettle without a stale closure. Non-null == practicing. */
  const practiceRef = useRef<PracticeSession | null>(null);
  const [summary, setSummary] = useState<TowerFinalSummary | null>(null);
  const [muted, setMuted] = useState(() => readMuted());
  const [reducedMotion, setReducedMotion] = useState(() => readReducedMotionPref());

  // Keep the audio engine's mute flag in sync with the persisted preference.
  useEffect(() => {
    setAudioMuted(muted);
  }, [muted]);

  const toggleMuted = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      writeMuted(next);
      if (!next) initAudio(); // unmuting is a gesture — safe to start audio
      return next;
    });
  }, []);

  const toggleReducedMotion = useCallback(() => {
    setReducedMotion((prev) => {
      const next = !prev;
      writeReducedMotionPref(next);
      return next;
    });
  }, []);
  /** Guards the one-time auto-show so a retry/re-bootstrap never re-triggers it. */
  const tutorialEvaluatedRef = useRef(false);

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
    const bridge = bridgeRef.current;
    if (!bridge) return;

    // Practice Mode is fully local: resolve the drop with NO server call at all.
    if (practiceRef.current) {
      if (settle.stable) {
        bridge.commitLocal(); // keep the settled body so the next one stacks
        const newBody = practiceBodyFromSettle(settle);
        practiceRef.current = recordPractice(practiceRef.current, 'stayed', newBody);
        setMessage('It stayed! Place another — practice only.');
      } else {
        // The scene already restored the local practice snapshot.
        practiceRef.current = recordPractice(practiceRef.current, 'collapsed', null);
        setMessage(settle.message ?? 'Collapsed — your practice tower was restored.');
      }
      setPractice(practiceRef.current);
      return;
    }

    const attempt = attemptRef.current;
    if (!attempt) return;

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
      // A milestone crossed by THIS placement is celebrated once (server-flagged).
      if (res.milestone) {
        setMilestone(res.milestone);
        playMilestone();
        bridge.celebrate();
      }
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
      setUsername(res.username);
      setPlayer(res.player);
      setReadOnly(res.readOnly);
      setErrorKind(null);
      setSummary(res.summary);
      applyTower(res.tower);
      setUiPhase('idle');
      // First-time experience: auto-show once, never re-interrupt on retries.
      if (!tutorialEvaluatedRef.current) {
        tutorialEvaluatedRef.current = true;
        if (shouldAutoShowTutorial()) setShowTutorial(true);
      }
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
    initAudio(); // first real user gesture — safe to start the audio context
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
  const onDrop = useCallback(() => {
    initAudio();
    bridgeRef.current?.drop();
  }, []);

  // ---- practice mode (client-only, never touches the server) ---------------

  const onEnterPractice = useCallback(() => {
    const official = towerRef.current;
    if (!official) return;
    clearInspection();
    setMessage(null);
    attemptRef.current = null; // ensure no official attempt is in flight
    const session = startPractice(official);
    practiceRef.current = session;
    setPractice(session);
    setUiPhase('idle');
  }, [clearInspection]);

  const onPracticeChoose = useCallback((objectId: string) => {
    const bridge = bridgeRef.current;
    if (!bridge || !practiceRef.current) return;
    setMessage(null);
    // baseTowerVersion is irrelevant here — practice never sends it anywhere.
    bridge.beginPlacement(objectId, crypto.randomUUID(), towerRef.current?.meta.version ?? 0);
  }, []);

  const onExitPractice = useCallback(() => {
    bridgeRef.current?.cancelActive();
    practiceRef.current = null;
    setPractice(null);
    setMessage(null);
    clearInspection();
    // Restore the official accepted tower exactly (discards all practice bodies).
    const official = towerRef.current;
    if (official) applyTower(official);
    setUiPhase('idle');
  }, [applyTower, clearInspection]);

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
  const communityStatus = tower ? currentMilestone(tower.meta.successfulPlacements) : null;
  const modifier = tower ? getModifier(tower.meta.modifierId) : null;
  const inspection =
    inspectBodyId && tower ? inspectionModel(inspectBodyId, tower, userId) : null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#f6f7fc] text-slate-800 select-none">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Hero header — daily title + live stats + countdown. Compact so the
          tower stays the visual hero. Stacks tighter on mobile. */}
      {tower && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3 sm:p-4">
          {/* Stats card. */}
          <div className="pointer-events-auto rounded-2xl bg-white/90 px-4 py-2.5 shadow-lg shadow-indigo-200/50 ring-1 ring-indigo-100 backdrop-blur">
            <div className="flex items-stretch gap-3">
              {towerStats(tower).map((s, i) => (
                <div key={s.key} className="flex items-center">
                  {i > 0 && <div className="mr-3 h-8 w-px bg-indigo-100" />}
                  <div className="text-center leading-none">
                    <div className="text-lg font-black text-indigo-500 sm:text-xl">{s.value}</div>
                    <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                      {s.label}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {(communityStatus || (modifier && modifier.id !== 'normal')) && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {communityStatus && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-600">
                    🏆 {communityStatus.title}
                  </span>
                )}
                {modifier && modifier.id !== 'normal' && (
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[9px] font-semibold text-indigo-600">
                    ✦ {modifier.label}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            {/* Countdown card. */}
            <div className="pointer-events-auto rounded-2xl bg-white/90 px-4 py-2.5 text-right shadow-lg shadow-indigo-200/50 ring-1 ring-indigo-100 backdrop-blur">
              <div className="flex items-center justify-end gap-2">
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">
                    Closes in
                  </div>
                  <div className="text-lg font-black text-indigo-500">{countdown}</div>
                </div>
                <span className="text-lg text-indigo-400">⏱</span>
              </div>
            </div>
            <div className="pointer-events-auto flex gap-1.5">
              <button
                onClick={toggleMuted}
                aria-label={muted ? 'Unmute' : 'Mute'}
                aria-pressed={muted}
                title={muted ? 'Unmute' : 'Mute'}
                className="rounded-xl bg-white/90 px-2.5 py-1.5 text-sm shadow ring-1 ring-indigo-100 hover:bg-white"
              >
                {muted ? '🔇' : '🔊'}
              </button>
              <button
                onClick={toggleReducedMotion}
                aria-label="Toggle reduced motion"
                aria-pressed={reducedMotion}
                title={reducedMotion ? 'Reduced motion: on' : 'Reduced motion: off'}
                className={`rounded-xl px-2.5 py-1.5 text-sm shadow ring-1 ${
                  reducedMotion
                    ? 'bg-indigo-100 text-indigo-600 ring-indigo-200'
                    : 'bg-white/90 text-slate-500 ring-indigo-100 hover:bg-white'
                }`}
              >
                🎬
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Practice banner — always visible while practicing (required copy). */}
      {practice && (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center px-3 sm:top-20">
          <div className="pointer-events-auto rounded-full bg-indigo-500/90 px-4 py-1.5 text-center text-[12px] font-semibold text-white shadow-lg shadow-indigo-300/50 backdrop-blur">
            🧪 {PRACTICE_BANNER}
          </div>
        </div>
      )}

      {/* Inspection card — appears when an accepted body is tapped. */}
      {inspection && !practice && (
        <InspectionCard inspection={inspection} now={now} onClose={clearInspection} />
      )}

      {/* Bottom control zone */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-3 sm:p-4">
        {message && (
          <div className="pointer-events-auto max-w-sm rounded-xl bg-white/95 px-4 py-2 text-center text-sm text-slate-700 shadow-lg ring-1 ring-indigo-100 backdrop-blur">
            {message}
          </div>
        )}

        {isLaunchPhase && !practice && (
          <LaunchPanel
            state={launchState}
            player={player}
            emptyTower={tower ? towerIsEmpty(tower) : false}
            canPractice={tower !== null}
            modifier={modifier}
            onAdd={onAddOneMore}
            onHowItWorks={() => setShowTutorial(true)}
            onLeaderboard={() => setShowLeaderboard(true)}
            onArchive={() => setShowArchive(true)}
            onPractice={onEnterPractice}
            onRetry={() => {
              setUiPhase('loading');
              void loadTowerData();
            }}
          />
        )}

        {isLaunchPhase && !practice && launchState === 'finalized' && summary && tower && (
          <DailyResults
            summary={summary}
            modifier={modifier}
            personal={personalResult(tower, summary, userId, username, player)}
          />
        )}

        {practice && (
          <PracticePanel
            session={practice}
            scenePhase={scenePhase}
            onChoose={onPracticeChoose}
            onRotate={onRotate}
            onDrop={onDrop}
            onExit={onExitPractice}
          />
        )}

        {uiPhase === 'selecting' && (
          <SelectionPanel choices={choices} modifier={modifier} onChoose={onChoose} />
        )}

        {uiPhase === 'placing' && scenePhase === 'placing' && (
          <PlacementControls onRotate={onRotate} onDrop={onDrop} armed />
        )}

        {scenePhase === 'settling' && uiPhase !== 'evaluating' && (
          <div className="pointer-events-auto rounded-xl bg-white/95 px-6 py-2 text-lg font-bold text-slate-700 shadow-lg ring-1 ring-indigo-100 backdrop-blur">
            {STABILITY_LABEL_TEXT[stabilityLabel]}
          </div>
        )}

        {uiPhase === 'evaluating' && (
          <div className="pointer-events-auto rounded-xl bg-white/95 px-5 py-2 text-lg font-bold text-emerald-600 shadow-lg ring-1 ring-indigo-100 backdrop-blur">
            {STABILITY_LABEL_TEXT.locked} <span className="text-sm font-medium text-slate-400">saving…</span>
          </div>
        )}

        {uiPhase === 'success' && result && (
          <ResultPanel
            title="It stays!"
            accent="text-emerald-600"
            lines={[
              `You added object #${result.sequenceNumber}: ${result.objectName}.`,
              `+${result.score} points${player ? ` · ${player.score} today` : ''} · ${result.contributors} builders so far.`,
              canAddAnother(player) && player
                ? `You can still add ${player.placementsRemaining} more object${player.placementsRemaining === 1 ? '' : 's'} today.`
                : 'Come back before the tower closes to see what gets built above you.',
            ]}
            primaryLabel={canAddAnother(player) ? 'Add another object' : 'Inspect the tower'}
            onPrimary={() => {
              if (canAddAnother(player)) void onAddOneMore();
              else setUiPhase('idle');
            }}
          />
        )}

        {uiPhase === 'collapse' && (
          <ResultPanel
            title="Collapse!"
            accent="text-rose-500"
            lines={[
              'Good news: the last stable version survived.',
              player
                ? `${player.attemptsRemaining} attempt${player.attemptsRemaining === 1 ? '' : 's'} left today.`
                : '',
            ]}
            primaryLabel={canAddAnother(player) ? 'Try again' : 'Back to tower'}
            onPrimary={() => {
              if (canAddAnother(player)) void onAddOneMore();
              else setUiPhase('idle');
            }}
          />
        )}
      </div>

      {milestone && (
        <MilestoneCelebration milestone={milestone} onClose={() => setMilestone(null)} />
      )}

      {showLeaderboard && <LeaderboardModal onClose={() => setShowLeaderboard(false)} />}

      {showArchive && <ArchiveModal onClose={() => setShowArchive(false)} />}

      {showTutorial && (
        <Tutorial
          onClose={() => {
            markTutorialSeen();
            setShowTutorial(false);
          }}
        />
      )}
    </div>
  );
};

// ---- milestones + leaderboards (Task 13) -----------------------------------

const MilestoneCelebration = ({
  milestone,
  onClose,
}: {
  milestone: MilestoneInfo;
  onClose: () => void;
}) => (
  <div
    className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm"
    onClick={onClose}
  >
    <div
      className="w-full max-w-xs rounded-2xl bg-white px-6 py-6 text-center shadow-2xl ring-1 ring-emerald-200"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-4xl">🎉</div>
      <div className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-emerald-500">
        Community milestone
      </div>
      <div className="mt-1 text-xl font-black leading-snug text-slate-800">{milestone.title}</div>
      <p className="mt-2 text-[12px] text-slate-500">
        The whole community built this together. You were part of it.
      </p>
      <button
        onClick={onClose}
        className="mt-4 w-full rounded-full bg-emerald-500 px-6 py-2 text-sm font-bold text-white hover:bg-emerald-600"
      >
        Nice
      </button>
    </div>
  </div>
);

const LeaderboardModal = ({ onClose }: { onClose: () => void }) => {
  const [boards, setBoards] = useState<LeaderboardBoard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchLeaderboard();
      if (cancelled) return;
      if ('type' in res) setBoards(res.boards);
      else setError(res.message);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-indigo-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div className="text-lg font-black text-slate-800">🏆 Leaderboards</div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full px-2 text-lg leading-none text-slate-400 hover:text-slate-700"
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-3">
          {error && <div className="py-6 text-center text-sm text-rose-500">{error}</div>}
          {!error && !boards && (
            <div className="py-6 text-center text-sm text-slate-400">Loading…</div>
          )}
          {boards?.map((board) => (
            <div key={board.id} className="mb-4 last:mb-1">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                {board.title}
              </div>
              {board.entries.length === 0 ? (
                <div className="text-[12px] italic text-slate-400">No entries yet.</div>
              ) : (
                <ol className="space-y-0.5">
                  {board.entries.map((e) => (
                    <li
                      key={`${board.id}-${e.rank}`}
                      className={`flex items-baseline justify-between gap-3 rounded-lg px-2 py-1 text-[13px] ${
                        e.isViewer ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600'
                      }`}
                    >
                      <span className="truncate">
                        <span className="text-slate-400">{e.rank}.</span> u/{e.username}
                        {e.isViewer && <span className="ml-1 text-[10px] text-indigo-500">you</span>}
                      </span>
                      <span className="font-semibold tabular-nums">{e.value}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ---- launch screen ---------------------------------------------------------

const LaunchPanel = ({
  state,
  player,
  emptyTower,
  canPractice,
  modifier,
  onAdd,
  onHowItWorks,
  onLeaderboard,
  onArchive,
  onPractice,
  onRetry,
}: {
  state: LaunchState;
  player: PlayerDailyState | null;
  emptyTower: boolean;
  canPractice: boolean;
  modifier: DailyModifier | null;
  onAdd: () => void;
  onHowItWorks: () => void;
  onLeaderboard: () => void;
  onArchive: () => void;
  onPractice: () => void;
  onRetry: () => void;
}) => {
  if (state === 'loading') return <LoadingSkeleton />;

  if (state === 'network-error' || state === 'redis-error') {
    const redis = state === 'redis-error';
    return (
      <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-3 rounded-2xl bg-white/95 px-5 py-4 text-center shadow-lg ring-1 ring-indigo-100 backdrop-blur">
        <div className="text-lg font-black text-rose-500">
          {redis ? 'Storage is unavailable' : 'Connection problem'}
        </div>
        <p className="text-[12px] leading-snug text-slate-500">
          {redis
            ? 'The tower’s storage is temporarily unreachable. Nothing you did was lost.'
            : 'We couldn’t reach the server. Check your connection and try again.'}
        </p>
        <button
          onClick={onRetry}
          className="rounded-full bg-indigo-500 px-6 py-2 text-sm font-bold text-white hover:bg-indigo-600"
        >
          Try again
        </button>
      </div>
    );
  }

  const note = contributionStatus(state, player);

  return (
    <div className="pointer-events-auto flex w-full max-w-sm flex-col items-center gap-2.5">
      {(state === 'ready' || state === 'no-attempts') && (
        <p className="max-w-xs text-center text-[12px] leading-snug text-slate-500">
          {emptyTower
            ? 'Nobody has placed anything yet. Set the foundation for today’s tower.'
            : 'Everyone builds the same tower. Add one object — if it stays, it becomes the next player’s problem.'}
        </p>
      )}

      {state === 'read-only' && (
        <div className="rounded-xl bg-amber-50 px-4 py-2 text-center text-xs text-amber-700 ring-1 ring-amber-200">
          Read-only — saving is temporarily unavailable. You can still watch and inspect the tower.
        </div>
      )}
      {state === 'finalized' && (
        <div className="rounded-xl bg-white/90 px-4 py-2 text-center text-xs text-slate-600 shadow ring-1 ring-indigo-100">
          Today’s tower is finalized. See the results below or browse the archive.
        </div>
      )}

      {/* Modifier explainer — shown clearly BEFORE an attempt. */}
      {modifier && (state === 'ready' || state === 'no-attempts') && (
        <ModifierExplainer modifier={modifier} />
      )}
      {state === 'unauthenticated' && (
        <div className="rounded-xl bg-white/90 px-4 py-2 text-center text-xs text-slate-600 shadow ring-1 ring-indigo-100">
          Open this post in the Reddit app and sign in to add your object. You can still inspect it.
        </div>
      )}

      {/* Contribution status pill (matches the friendly "done for today" state). */}
      {state === 'contributed' && (
        <div className="flex items-center gap-2 text-[15px] font-semibold text-slate-700">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-sm text-emerald-600">
            ✓
          </span>
          {player && player.successfulPlacements > 1
            ? `Your ${player.successfulPlacements} objects are in today’s tower`
            : 'Your object is in today’s tower'}
        </div>
      )}

      {(state === 'ready' || state === 'no-attempts') && (
        <button
          onClick={onAdd}
          disabled={!canStartAttempt(state)}
          className="w-full rounded-2xl bg-indigo-500 px-8 py-3.5 text-base font-black tracking-wide text-white shadow-lg shadow-indigo-300/50 transition-colors hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-40 sm:text-lg"
        >
          ADD ONE MORE THING
        </button>
      )}

      {note && <div className="text-[11px] text-slate-400">{note}</div>}

      {/* Primary secondary action — the Leaderboard card (as in the reference). */}
      <button
        onClick={onLeaderboard}
        className="flex w-40 flex-col items-center gap-0.5 rounded-2xl bg-white/90 px-6 py-3 text-indigo-500 shadow-lg shadow-indigo-200/50 ring-1 ring-indigo-100 transition-colors hover:bg-white"
      >
        <span className="text-xl leading-none">🏆</span>
        <span className="text-sm font-bold text-slate-700">Leaderboard</span>
      </button>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        {canPractice && (
          <button
            onClick={onPractice}
            className="text-[11px] font-semibold uppercase tracking-widest text-indigo-400 hover:text-indigo-600"
          >
            🧪 Practice
          </button>
        )}
        <button
          onClick={onHowItWorks}
          className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 hover:text-slate-600"
        >
          How it works
        </button>
        <button
          onClick={onArchive}
          className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 hover:text-slate-600"
        >
          Archive
        </button>
      </div>
    </div>
  );
};

const LoadingSkeleton = () => (
  <div className="pointer-events-auto flex w-full max-w-sm animate-pulse flex-col items-center gap-3">
    <div className="h-3 w-56 rounded bg-indigo-200/60" />
    <div className="h-12 w-full max-w-xs rounded-2xl bg-indigo-200/50" />
    <div className="h-2.5 w-28 rounded bg-indigo-200/50" />
    <div className="mt-1 text-[11px] text-slate-400">Loading the community tower…</div>
  </div>
);

/** Clear, one-line explanation of the day's modifier, shown before an attempt. */
const ModifierExplainer = ({ modifier }: { modifier: DailyModifier }) => (
  <div
    className={`w-full max-w-xs rounded-xl px-3 py-2 text-center text-[11px] ${
      modifier.id === 'normal'
        ? 'bg-white/80 text-slate-500 ring-1 ring-indigo-100'
        : 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200'
    }`}
  >
    <span className="font-bold">✦ {modifier.label}</span>
    <span className="mx-1 opacity-60">—</span>
    <span>{modifier.description}</span>
  </div>
);

// ---- daily results + community-monument archive (Task 17) ------------------

type PersonalResult = {
  contributed: boolean;
  objectName: string;
  sequenceNumber: number;
  placementCount: number;
  score: number;
  attemptsUsed: number;
  awards: string[];
};

/** Derive the viewer's own result from the finalized tower (client-side, per-user). */
function personalResult(
  tower: TowerState,
  summary: TowerFinalSummary,
  userId: string | null,
  username: string,
  player: PlayerDailyState | null
): PersonalResult {
  // A player may have placed several objects today — show the most recent, plus
  // the count and the summed daily score.
  const ownBodies = userId
    ? tower.bodies.filter((b) => b.ownerUserId === userId && b.ownerUserId.length > 0)
    : [];
  const lastOwn = ownBodies.reduce<PersistedBodyState | undefined>(
    (best, b) => (best && best.sequenceNumber >= b.sequenceNumber ? best : b),
    undefined
  );
  const awards = username
    ? summary.awards.filter((a) => a.username === username).map((a) => a.label)
    : [];
  return {
    contributed: player?.hasSucceeded ?? ownBodies.length > 0,
    objectName: lastOwn ? getObjectDef(lastOwn.objectId)?.name ?? lastOwn.objectId : '',
    sequenceNumber: lastOwn?.sequenceNumber ?? 0,
    placementCount: player?.successfulPlacements ?? ownBodies.length,
    score: player?.score ?? 0,
    attemptsUsed: player?.attemptsUsed ?? 0,
    awards,
  };
}

/** The finalized-day results screen (Task 17): all required fields + 6 awards. */
const DailyResults = ({
  summary,
  modifier,
  personal,
}: {
  summary: TowerFinalSummary;
  modifier: DailyModifier | null;
  personal: PersonalResult;
}) => (
  <div className="pointer-events-auto flex max-h-[62vh] w-full max-w-sm flex-col overflow-y-auto rounded-2xl bg-white/95 px-4 py-3 shadow-xl ring-1 ring-indigo-100 backdrop-blur">
    <div className="flex items-center justify-between">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-indigo-500">
        Daily results · {summary.dayKey}
      </div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Closed</div>
    </div>

    <div className="mt-2 grid grid-cols-4 gap-2 text-center">
      <SummaryStat label="Height" value={String(summary.finalHeight)} />
      <SummaryStat label="Objects" value={String(summary.totalObjects)} />
      <SummaryStat label="Builders" value={String(summary.uniqueContributors)} />
      <SummaryStat label="Attempts" value={String(summary.totalAttempts)} />
    </div>

    <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-[10px]">
      {modifier && (
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-600">✦ {modifier.label}</span>
      )}
      {summary.milestonesUnlocked.length > 0 && (
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-600">
          🏆 {summary.milestonesUnlocked.length} milestone
          {summary.milestonesUnlocked.length === 1 ? '' : 's'}
        </span>
      )}
    </div>

    {/* Personal result. */}
    <div className="mt-3 rounded-xl bg-indigo-50 px-3 py-2 text-[12px]">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Your result</div>
      {personal.contributed ? (
        <div className="mt-0.5 text-slate-600">
          {personal.placementCount > 1 ? (
            <>
              You placed <span className="font-semibold text-slate-800">{personal.placementCount} objects</span>{' '}
              (latest: {personal.objectName}, object #{personal.sequenceNumber}) for {personal.score} pts ·{' '}
              {personal.attemptsUsed} attempt{personal.attemptsUsed === 1 ? '' : 's'} used.
            </>
          ) : (
            <>
              You placed <span className="font-semibold text-slate-800">{personal.objectName}</span> (object #
              {personal.sequenceNumber}) for {personal.score} pts · {personal.attemptsUsed} attempt
              {personal.attemptsUsed === 1 ? '' : 's'} used.
            </>
          )}
          {personal.awards.length > 0 && (
            <span className="font-semibold text-amber-600"> You won: {personal.awards.join(', ')}.</span>
          )}
        </div>
      ) : (
        <div className="mt-0.5 text-slate-400">
          You didn’t add to this tower. There’s always the next one.
        </div>
      )}
    </div>

    {/* Awards. */}
    {summary.awards.length > 0 && (
      <div className="mt-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Daily awards</div>
        <div className="mt-1 space-y-1">
          {summary.awards.map((a) => (
            <div key={a.id} className="flex items-baseline justify-between gap-3 text-[12px]">
              <span className="text-slate-400">{a.label}</span>
              <span className="font-medium text-slate-700">
                u/{a.username} <span className="text-slate-400">· {a.detail}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
);

const SummaryStat = ({ label, value }: { label: string; value: string }) => (
  <div className="leading-none">
    <div className="text-lg font-black text-indigo-500">{value}</div>
    <div className="text-[9px] uppercase tracking-wider text-slate-400">{label}</div>
  </div>
);

/** The community-monument archive — secondary to today's tower (Task 17). */
const ArchiveModal = ({ onClose }: { onClose: () => void }) => {
  const [entries, setEntries] = useState<TowerFinalSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchArchive();
      if (cancelled) return;
      if ('type' in res) setEntries(res.entries);
      else setError(res.message);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-indigo-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div className="text-lg font-black text-slate-800">🗿 Community archive</div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full px-2 text-lg leading-none text-slate-400 hover:text-slate-700"
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-3">
          {error && <div className="py-6 text-center text-sm text-rose-500">{error}</div>}
          {!error && !entries && (
            <div className="py-6 text-center text-sm text-slate-400">Loading…</div>
          )}
          {entries?.length === 0 && (
            <div className="py-6 text-center text-[13px] text-slate-400">
              No finalized towers yet. Come back after today’s tower closes.
            </div>
          )}
          {entries?.map((e) => (
            <ArchiveRow key={e.towerId} entry={e} />
          ))}
        </div>
      </div>
    </div>
  );
};

const ArchiveRow = ({ entry }: { entry: TowerFinalSummary }) => {
  const modifier = getModifier(entry.modifierId);
  const top = entry.awards[0];
  return (
    <div className="mb-2 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100 last:mb-0">
      <div className="flex items-baseline justify-between">
        <div className="text-[13px] font-bold text-slate-700">{entry.dayKey}</div>
        {modifier.id !== 'normal' && (
          <div className="text-[10px] text-indigo-500">✦ {modifier.label}</div>
        )}
      </div>
      <div className="mt-0.5 flex gap-3 text-[11px] text-slate-400">
        <span>{entry.finalHeight}u tall</span>
        <span>{entry.totalObjects} objects</span>
        <span>{entry.uniqueContributors} builders</span>
      </div>
      {top && (
        <div className="mt-0.5 text-[11px] text-slate-500">
          {top.label}: <span className="font-medium">u/{top.username}</span>
          {entry.milestonesUnlocked.length > 0 && (
            <span className="text-emerald-500">
              {' '}
              · {getMilestone(entry.milestonesUnlocked[entry.milestonesUnlocked.length - 1] ?? '')?.title ?? ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

const InspectionCard = ({
  inspection,
  now,
  onClose,
}: {
  inspection: InspectionModel;
  now: number;
  onClose: () => void;
}) => (
  <div className="pointer-events-auto absolute left-1/2 top-1/2 w-64 max-w-[80vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white px-4 py-3 shadow-xl ring-1 ring-indigo-100">
    <div className="flex items-start justify-between gap-2">
      <div className="text-base font-bold text-slate-800">{inspection.objectName}</div>
      <button
        onClick={onClose}
        aria-label="Close"
        className="-mr-1 -mt-1 rounded-full px-2 text-lg leading-none text-slate-400 hover:text-slate-700"
      >
        ×
      </button>
    </div>
    {inspection.isOwn && (
      <div className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-600">
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
    <span className={`font-medium text-slate-700 ${valueClass ?? ''}`}>{value}</span>
  </div>
);

// ---- first-time tutorial (Task 11) -----------------------------------------

/**
 * The three-step first-time experience. Visual (not a rule page), skippable at
 * any point, and used both as the auto-shown onboarding and as the "How it
 * works" replay. Closing (Skip or Start building) marks it seen.
 */
const Tutorial = ({ onClose }: { onClose: () => void }) => {
  const [step, setStep] = useState(0);
  const current = TUTORIAL_STEPS[clampStep(step)];
  const last = isLastStep(step);
  if (!current) return null;

  return (
    <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white px-5 pb-5 pt-4 shadow-2xl ring-1 ring-indigo-100">
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5" aria-label={`Step ${step + 1} of ${TUTORIAL_STEPS.length}`}>
            {TUTORIAL_STEPS.map((s) => (
              <span
                key={s.index}
                className={`h-1.5 w-6 rounded-full transition-colors ${
                  s.index <= step ? 'bg-indigo-500' : 'bg-indigo-100'
                }`}
              />
            ))}
          </div>
          <button
            onClick={onClose}
            className="rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-widest text-slate-400 hover:text-slate-700"
          >
            Skip
          </button>
        </div>

        <div className="mt-4 flex h-40 items-center justify-center rounded-xl bg-indigo-50">
          <TutorialVisual step={clampStep(step)} />
        </div>

        <div className="mt-4 text-center text-lg font-black leading-snug text-slate-800">
          {current.title}
        </div>
        <p className="mt-1 text-center text-[12px] leading-snug text-slate-500">
          {current.caption}
        </p>

        <div className="mt-4 flex items-center gap-2">
          {step > 0 && (
            <button
              onClick={() => setStep((s) => clampStep(s - 1))}
              className="rounded-full px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-800"
            >
              Back
            </button>
          )}
          <button
            onClick={() => (last ? onClose() : setStep((s) => clampStep(s + 1)))}
            className="ml-auto rounded-full bg-indigo-500 px-6 py-2 text-sm font-bold text-white hover:bg-indigo-600"
          >
            {last ? 'Start building' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
};

/** Lightweight per-step illustration — geometry, not screenshots. */
const TutorialVisual = ({ step }: { step: number }) => {
  if (step === 0) {
    // One shared tower + many contributors.
    return (
      <svg viewBox="0 0 120 120" className="h-32 w-32">
        <rect x="24" y="86" width="72" height="8" rx="2" fill="#3a3f4b" />
        <rect x="40" y="70" width="40" height="16" rx="2" fill="#c8a45a" stroke="#8a6d33" />
        <rect x="46" y="56" width="30" height="14" rx="2" fill="#3f7d6e" stroke="#1f3f38" />
        <rect x="50" y="44" width="22" height="12" rx="2" fill="#b5613b" stroke="#6e3722" />
        {[28, 46, 64, 82].map((cx) => (
          <circle key={cx} cx={cx} cy="104" r="5" fill="#6c7ac9" />
        ))}
      </svg>
    );
  }
  if (step === 1) {
    // Choose / rotate / drop.
    return (
      <svg viewBox="0 0 120 120" className="h-32 w-32">
        <rect x="46" y="46" width="28" height="28" rx="3" fill="#c98a3c" stroke="#7a4f1d" transform="rotate(12 60 60)" />
        <path d="M32 40 a20 20 0 0 1 12 -12" fill="none" stroke="#94a3b8" strokeWidth="3" />
        <path d="M88 40 a20 20 0 0 0 -12 -12" fill="none" stroke="#94a3b8" strokeWidth="3" />
        <path d="M60 82 l0 20 M52 96 l8 8 l8 -8" fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  // It stays → next player's problem.
  return (
    <svg viewBox="0 0 120 120" className="h-32 w-32">
      <rect x="30" y="86" width="60" height="8" rx="2" fill="#3a3f4b" />
      <rect x="42" y="70" width="36" height="16" rx="2" fill="#c8a45a" stroke="#8a6d33" />
      <rect x="48" y="54" width="24" height="16" rx="2" fill="#3f7d6e" stroke="#1f3f38" />
      <circle cx="60" cy="34" r="12" fill="#10b981" />
      <path d="M54 34 l4 4 l8 -8" fill="none" stroke="#052e1a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

/** Compact SVG preview of a catalogue object for the selection cards. */
const ObjectPreviewSvg = ({ objectId, size = 56 }: { objectId: string; size?: number }) => {
  const preview: ObjectPreview | null = buildPreview(objectId, size);
  if (!preview) return null;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      {preview.prims.map((prim, i) => {
        if (prim.kind === 'rect') {
          return (
            <rect
              key={i}
              x={prim.x}
              y={prim.y}
              width={prim.w}
              height={prim.h}
              rx={2}
              fill={preview.fill}
              stroke={preview.stroke}
              strokeWidth={1.5}
            />
          );
        }
        if (prim.kind === 'circle') {
          return (
            <circle key={i} cx={prim.cx} cy={prim.cy} r={prim.r} fill={preview.fill} stroke={preview.stroke} strokeWidth={1.5} />
          );
        }
        return <polygon key={i} points={prim.points} fill={preview.fill} stroke={preview.stroke} strokeWidth={1.5} />;
      })}
    </svg>
  );
};

// ---- practice mode UI (Task 15) --------------------------------------------

/** Extract the just-placed body's settled transform for the local session. */
function practiceBodyFromSettle(settle: SettleResult): PersistedBodyState | null {
  const b = settle.bodies.find((x) => x.bodyId === settle.newBodyId);
  if (!b) return null;
  return {
    bodyId: b.bodyId,
    objectId: b.objectId,
    ownerUserId: '',
    ownerUsername: '',
    sequenceNumber: 0,
    x: b.x,
    y: b.y,
    angle: b.angle,
    scaleX: 1,
    scaleY: 1,
  };
}

const PracticePanel = ({
  session,
  scenePhase,
  onChoose,
  onRotate,
  onDrop,
  onExit,
}: {
  session: PracticeSession;
  scenePhase: ScenePhase;
  onChoose: (objectId: string) => void;
  onRotate: (dir: -1 | 1) => void;
  onDrop: () => void;
  onExit: () => void;
}) => {
  if (scenePhase === 'placing') {
    return (
      <div className="pointer-events-auto flex w-full max-w-sm flex-col items-center gap-2">
        <PlacementControls onRotate={onRotate} onDrop={onDrop} armed />
        <button
          onClick={onExit}
          className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 hover:text-slate-200"
        >
          Exit practice
        </button>
      </div>
    );
  }
  // Settling/collapsing: the shared stability label is shown elsewhere; just keep
  // the exit affordance out of the way until control returns.
  if (scenePhase === 'settling' || scenePhase === 'collapsing') {
    return null;
  }
  return (
    <div className="pointer-events-auto flex w-full max-w-md flex-col items-center gap-2">
      <div className="flex items-center gap-3 text-[11px] text-slate-400">
        <span>Placed: {session.placed}</span>
        <span>·</span>
        <span>Collapses: {session.collapses}</span>
      </div>
      <div className="text-xs uppercase tracking-widest text-slate-400">
        Pick any object — unlimited tries
      </div>
      <div className="flex max-h-[34vh] w-full flex-wrap justify-center gap-1.5 overflow-y-auto rounded-2xl bg-white/90 p-2 shadow-lg ring-1 ring-indigo-100 backdrop-blur">
        {OBJECT_LIBRARY.map((def) => (
          <button
            key={def.id}
            onClick={() => onChoose(def.id)}
            title={`${def.name} · ${def.difficulty}`}
            className={`flex h-14 w-14 items-center justify-center rounded-xl border bg-indigo-50/60 transition-transform hover:scale-105 ${
              DIFFICULTY_STYLE[def.difficulty] ?? 'border-slate-200'
            }`}
          >
            <ObjectPreviewSvg objectId={def.id} size={44} />
          </button>
        ))}
      </div>
      <button
        onClick={onExit}
        className="rounded-full bg-slate-200 px-6 py-2 text-sm font-bold text-slate-700 hover:bg-slate-300"
      >
        Exit to community tower
      </button>
    </div>
  );
};

// ---- attempt flow panels (unchanged behaviour) -----------------------------

const SelectionPanel = ({
  choices,
  modifier,
  onChoose,
}: {
  choices: ObjectChoice[];
  modifier: DailyModifier | null;
  onChoose: (c: ObjectChoice) => void;
}) => {
  const cards = useMemo(() => selectionCards(choices), [choices]);
  const [selection, setSelection] = useState<SelectionState>(() => initialSelection());

  const commit = useCallback(
    (objectId: string) => {
      const choice = choices.find((c) => c.objectId === objectId);
      if (choice) onChoose(choice);
    },
    [choices, onChoose]
  );

  const onTap = useCallback(
    (objectId: string) => {
      const { state, confirmedId } = tapCard(selection, objectId);
      setSelection(state);
      if (confirmedId) commit(confirmedId);
    },
    [selection, commit]
  );

  return (
    <div className="pointer-events-auto flex w-full max-w-md flex-col items-center gap-2">
      {modifier && modifier.id !== 'normal' && <ModifierExplainer modifier={modifier} />}
      <div className="text-xs uppercase tracking-widest text-slate-400">
        {selection.selectedId ? 'Tap again to place it' : 'Choose one'}
      </div>
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
        {cards.map((card) => (
          <SelectionOption
            key={card.objectId}
            card={card}
            selected={isSelected(selection, card.objectId)}
            onTap={() => onTap(card.objectId)}
          />
        ))}
      </div>
      {selection.selectedId && (
        <button
          onClick={() => commit(selection.selectedId as string)}
          className="mt-1 w-full max-w-xs rounded-2xl bg-indigo-500 px-6 py-2.5 text-sm font-black tracking-wide text-white shadow-lg shadow-indigo-300/50 hover:bg-indigo-600"
        >
          PLACE IT
        </button>
      )}
    </div>
  );
};

const SelectionOption = ({
  card,
  selected,
  onTap,
}: {
  card: SelectionCard;
  selected: boolean;
  onTap: () => void;
}) => (
  <button
    onClick={onTap}
    aria-pressed={selected}
    className={`flex flex-1 items-center gap-3 rounded-2xl border-2 bg-white px-3 py-2.5 text-left shadow-md shadow-indigo-100/60 transition-all sm:flex-col sm:items-center sm:gap-1.5 sm:py-3 sm:text-center ${
      selected
        ? 'border-indigo-400 ring-2 ring-indigo-300 scale-[1.02]'
        : `${DIFFICULTY_STYLE[card.difficulty] ?? 'border-slate-200 text-slate-600'} hover:scale-[1.02]`
    }`}
  >
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-indigo-50">
      <ObjectPreviewSvg objectId={card.objectId} size={48} />
    </div>
    <div className="min-w-0 flex-1 sm:flex-none">
      <div className="text-[13px] font-bold leading-tight text-slate-800">{card.name}</div>
      <div className="mt-0.5 flex items-center gap-2 sm:justify-center">
        <span className="text-[10px] font-semibold uppercase tracking-wide">
          {card.difficultyLabel}
        </span>
        <span className="text-[11px] text-slate-500">{card.baseScore} pts</span>
      </div>
      <div className="mt-1 text-[11px] italic leading-snug text-slate-400">{card.blurb}</div>
    </div>
  </button>
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
    <p className="rounded-full bg-white/80 px-3 py-1 text-[11px] text-slate-500 shadow-sm ring-1 ring-indigo-100">
      Drag to move · rotate · drop
    </p>
    <div className="flex w-full items-center justify-between gap-3">
      <button
        onClick={() => onRotate(-1)}
        className="h-14 w-14 rounded-2xl bg-white text-2xl font-bold text-indigo-500 shadow-md ring-1 ring-indigo-100 active:bg-indigo-50"
        aria-label="Rotate left"
      >
        ⟲
      </button>
      <button
        onClick={onDrop}
        disabled={!armed}
        className="h-16 flex-1 rounded-2xl bg-indigo-500 text-lg font-black tracking-wide text-white shadow-lg shadow-indigo-300/50 active:bg-indigo-600 disabled:opacity-40"
      >
        DROP
      </button>
      <button
        onClick={() => onRotate(1)}
        className="h-14 w-14 rounded-2xl bg-white text-2xl font-bold text-indigo-500 shadow-md ring-1 ring-indigo-100 active:bg-indigo-50"
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
  <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-2 rounded-2xl bg-white/95 px-5 py-4 text-center shadow-xl ring-1 ring-indigo-100 backdrop-blur">
    <div className={`text-xl font-black ${accent}`}>{title}</div>
    {lines.filter(Boolean).map((line, i) => (
      <p key={i} className="text-[12px] leading-snug text-slate-600">
        {line}
      </p>
    ))}
    <button
      onClick={onPrimary}
      className="mt-1 rounded-full bg-indigo-500 px-6 py-2 text-sm font-bold text-white hover:bg-indigo-600"
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
