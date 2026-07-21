import type {
  ArchiveResponse,
  BootstrapResponse,
  BuildStateResponse,
  CommitRequest,
  CommitResponse,
  ConflictResponse,
  ErrorResponse,
  FailResponse,
  LeaderboardResponse,
  MeResponse,
  PlaceBodyRequest,
  PlaceBodyResponse,
  PointsBoardResponse,
  ScoreResponse,
  StartAttemptResponse,
} from '../../shared/api';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isBootstrap(v: unknown): v is BootstrapResponse {
  return isRecord(v) && v.type === 'bootstrap';
}
function isStart(v: unknown): v is StartAttemptResponse {
  return isRecord(v) && v.type === 'attempt-start';
}
function isCommit(v: unknown): v is CommitResponse {
  return isRecord(v) && v.type === 'commit';
}
function isFail(v: unknown): v is FailResponse {
  return isRecord(v) && v.type === 'fail';
}
function isConflict(v: unknown): v is ConflictResponse {
  return isRecord(v) && v.status === 'conflict';
}
function isLeaderboard(v: unknown): v is LeaderboardResponse {
  return isRecord(v) && v.type === 'leaderboard';
}
function isMe(v: unknown): v is MeResponse {
  return isRecord(v) && v.type === 'me';
}
function isScore(v: unknown): v is ScoreResponse {
  return isRecord(v) && v.type === 'score';
}
function isPointsBoard(v: unknown): v is PointsBoardResponse {
  return isRecord(v) && v.type === 'points-board';
}
function isBuildState(v: unknown): v is BuildStateResponse {
  return isRecord(v) && v.type === 'build-state';
}
function isPlaced(v: unknown): v is PlaceBodyResponse {
  return isRecord(v) && v.type === 'placed';
}
function isArchive(v: unknown): v is ArchiveResponse {
  return isRecord(v) && v.type === 'archive';
}
function isError(v: unknown): v is ErrorResponse {
  return isRecord(v) && v.status === 'error';
}

function makeError(message: string): ErrorResponse {
  return { status: 'error', code: 'server-error', message };
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

export async function fetchBootstrap(): Promise<BootstrapResponse | ErrorResponse> {
  try {
    const data = await readJson(await fetch('/api/bootstrap'));
    if (isBootstrap(data)) return data;
    if (isError(data)) return data;
    return makeError('Could not load the tower.');
  } catch {
    return makeError('Network error while loading the tower.');
  }
}

export async function startAttempt(): Promise<StartAttemptResponse | ErrorResponse> {
  try {
    const res = await fetch('/api/attempt/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = await readJson(res);
    if (isStart(data)) return data;
    if (isError(data)) return data;
    return makeError('Could not start an attempt.');
  } catch {
    return makeError('Network error while starting an attempt.');
  }
}

export async function commitPlacement(
  req: CommitRequest
): Promise<CommitResponse | ConflictResponse | ErrorResponse> {
  try {
    const res = await fetch('/api/placement/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    const data = await readJson(res);
    if (isCommit(data)) return data;
    if (isConflict(data)) return data;
    if (isError(data)) return data;
    return makeError('Could not save your placement.');
  } catch {
    return makeError('Network error while saving your placement.');
  }
}

export async function fetchLeaderboard(
  limit?: number
): Promise<LeaderboardResponse | ErrorResponse> {
  try {
    const query = limit ? `?limit=${limit}` : '';
    const data = await readJson(await fetch(`/api/leaderboard${query}`));
    if (isLeaderboard(data)) return data;
    if (isError(data)) return data;
    return makeError('Could not load the leaderboards.');
  } catch {
    return makeError('Network error while loading the leaderboards.');
  }
}

export async function fetchMe(): Promise<MeResponse | ErrorResponse> {
  try {
    const data = await readJson(await fetch('/api/score/me'));
    if (isMe(data)) return data;
    if (isError(data)) return data;
    return makeError('Could not load your profile.');
  } catch {
    return makeError('Network error while loading your profile.');
  }
}

export async function addScore(points: number): Promise<ScoreResponse | ErrorResponse> {
  try {
    const res = await fetch('/api/score/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points }),
    });
    const data = await readJson(res);
    if (isScore(data)) return data;
    if (isError(data)) return data;
    return makeError('Could not record your score.');
  } catch {
    return makeError('Network error while recording your score.');
  }
}

export async function fetchPointsBoard(limit?: number): Promise<PointsBoardResponse | ErrorResponse> {
  try {
    const query = limit ? `?limit=${limit}` : '';
    const data = await readJson(await fetch(`/api/score/board${query}`));
    if (isPointsBoard(data)) return data;
    if (isError(data)) return data;
    return makeError('Could not load the leaderboard.');
  } catch {
    return makeError('Network error while loading the leaderboard.');
  }
}

export async function fetchBuildState(): Promise<BuildStateResponse | ErrorResponse> {
  try {
    const data = await readJson(await fetch('/api/build/state'));
    if (isBuildState(data)) return data;
    if (isError(data)) return data;
    return makeError('Could not load the tower.');
  } catch {
    return makeError('Network error while loading the tower.');
  }
}

export async function placeBody(body: PlaceBodyRequest): Promise<PlaceBodyResponse | ErrorResponse> {
  try {
    const res = await fetch('/api/build/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await readJson(res);
    if (isPlaced(data)) return data;
    if (isError(data)) return data;
    return makeError('Could not save your object.');
  } catch {
    return makeError('Network error while saving your object.');
  }
}

export async function fetchArchive(limit?: number): Promise<ArchiveResponse | ErrorResponse> {
  try {
    const query = limit ? `?limit=${limit}` : '';
    const data = await readJson(await fetch(`/api/archive${query}`));
    if (isArchive(data)) return data;
    if (isError(data)) return data;
    return makeError('Could not load the archive.');
  } catch {
    return makeError('Network error while loading the archive.');
  }
}

export async function failAttempt(
  attemptId: string
): Promise<FailResponse | ErrorResponse> {
  try {
    const res = await fetch('/api/attempt/fail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attemptId }),
    });
    const data = await readJson(res);
    if (isFail(data)) return data;
    if (isError(data)) return data;
    return makeError('Could not record the attempt.');
  } catch {
    return makeError('Network error.');
  }
}
