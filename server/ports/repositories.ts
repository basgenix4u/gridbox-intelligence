import type { RunMode, RunValidity } from "../../src/shared/contracts.js";

/**
 * Repository ports — the persistence boundary the services depend on.
 *
 * Services never see Drizzle, SQL or a connection string: they program
 * against these interfaces. That keeps the business logic unit-testable
 * against in-memory adapters, and keeps the Drizzle adapter a thin,
 * swappable detail. Mirrors the hexagonal style the game core already uses.
 */

export interface PlayerRecord {
  id: string;
  /** sha256 of the issued session token. The token itself is never stored. */
  anonTokenHash: string;
  displayName: string;
  initials: string;
  createdAt: Date;
  lastSeenAt: Date;
  totalRuns: number;
  bestScore: number;
}

export interface RunRecord {
  id: string;
  playerId: string;
  mode: RunMode;
  seed: number;
  day: string;
  score: number;
  level: number;
  chips: number;
  maxCombo: number;
  kills: number;
  durationMs: number;
  clientVersion: string;
  attestation: unknown;
  validity: RunValidity;
  scoringVersion: number;
  submittedAt: Date;
}

export interface NewRun {
  id: string;
  playerId: string;
  mode: RunMode;
  seed: number;
  day: string;
  score: number;
  level: number;
  chips: number;
  maxCombo: number;
  kills: number;
  durationMs: number;
  clientVersion: string;
  attestation: unknown;
  validity: RunValidity;
  scoringVersion: number;
}

export interface LeaderboardEntry {
  playerId: string;
  initials: string;
  score: number;
  level: number;
}

export interface DailyBoardEntry {
  playerId: string;
  initials: string;
  score: number;
  /** Level reached by the run that set this score; 0 for rows predating it. */
  level: number;
}

export interface NameReportRecord {
  id: number;
  reporterPlayerId: string | null;
  reportedPlayerId: string;
  reportedName: string;
  reason: string | null;
  status: string;
  createdAt: Date;
}

export interface AuditRecord {
  id: number;
  actor: string | null;
  action: string;
  meta: unknown;
  at: Date;
}

export interface PlayerRepository {
  findByTokenHash(anonTokenHash: string): Promise<PlayerRecord | null>;
  findById(id: string): Promise<PlayerRecord | null>;
  /** Creates a player with a caller-supplied id (the session token is bound to it). */
  create(input: { id: string; anonTokenHash: string; displayName: string; initials: string }): Promise<PlayerRecord>;
  touch(id: string): Promise<void>;
  updateName(id: string, name: { displayName: string; initials: string }): Promise<PlayerRecord>;
  /**
   * Folds finished runs into the player's totals (totalRuns, bestScore).
   * `runs` is the number of runs the score belongs to — one for a submitted
   * run, the batch size for a legacy migration.
   */
  addRunTotals(id: string, score: number, runs?: number): Promise<PlayerRecord>;
}

export interface RunRepository {
  findById(id: string): Promise<RunRecord | null>;
  /** Inserts a submitted run. Rejects (throws) a duplicate run id. */
  insert(run: NewRun): Promise<RunRecord>;
  setValidity(id: string, validity: RunValidity): Promise<void>;
  /** Best run per player, validity = ok, excluding names held for moderation. */
  globalBoard(mode: RunMode, limit: number): Promise<LeaderboardEntry[]>;
  /** The player's global rank and their slice of the board. */
  around(playerId: string, mode: RunMode, span: number): Promise<{ rank: number | null; rows: LeaderboardEntry[] }>;
  /** Today's board: the materialised daily table, excluding held names. */
  dailyBoard(day: string, mode: RunMode, limit: number): Promise<DailyBoardEntry[]>;
  /** Maintains the daily rollup: keeps the player's best score for the day. */
  upsertDailyBest(input: {
    day: string;
    mode: RunMode;
    playerId: string;
    initials: string;
    score: number;
    /** Level of the run being folded in; kept only when it sets a new best. */
    level: number;
  }): Promise<void>;
}

export interface LegacyScoreRecord {
  id: number;
  playerId: string;
  clientId: string;
  score: number;
  level: number;
  chips: number;
  maxCombo: number;
  playedAt: number;
  scoringVersion: number;
  migratedAt: Date;
}

export interface LegacyScoreRepository {
  /**
   * Stores a batch of legacy entries, skipping the ones already present.
   * The (player, client_id) unique index makes a retried upload a no-op;
   * the returned count is what was actually inserted.
   */
  insertMany(playerId: string, entries: readonly LegacyScoreInput[]): Promise<{ inserted: number }>;
  /** The player's migrated history, best first. */
  list(playerId: string, limit: number): Promise<LegacyScoreRecord[]>;
  /** True once the player has a migrated history — the client's one-shot guard. */
  hasAny(playerId: string): Promise<boolean>;
}

export interface LegacyScoreInput {
  clientId: string;
  score: number;
  level: number;
  chips: number;
  maxCombo: number;
  playedAt: number;
  scoringVersion: number;
}

export interface ReportRepository {
  create(input: {
    reporterPlayerId: string | null;
    reportedPlayerId: string;
    reportedName: string;
    reason: string;
  }): Promise<NameReportRecord>;
  listPending(limit: number): Promise<NameReportRecord[]>;
  resolve(id: number, status: "cleared" | "upheld", actor: string): Promise<NameReportRecord | null>;
  hasPendingReport(playerId: string): Promise<boolean>;
}

export interface AuditRecord {
  id: number;
  actor: string | null;
  action: string;
  meta: unknown;
  at: Date;
}

export interface AuditRepository {
  log(entry: { actor: string | null; action: string; meta: unknown }): Promise<void>;
  /** Newest first — the anti-cheat and moderation trail an operator reads. */
  list(limit: number): Promise<AuditRecord[]>;
}

export interface Repositories {
  players: PlayerRepository;
  runs: RunRepository;
  reports: ReportRepository;
  audit: AuditRepository;
  legacyScores: LegacyScoreRepository;
}
