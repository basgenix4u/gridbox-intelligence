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
  /** Folds a finished run into the player's totals (totalRuns, bestScore). */
  addRunTotals(id: string, score: number): Promise<PlayerRecord>;
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
  }): Promise<void>;
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

export interface AuditRepository {
  log(entry: { actor: string | null; action: string; meta: unknown }): Promise<void>;
}

export interface Repositories {
  players: PlayerRepository;
  runs: RunRepository;
  reports: ReportRepository;
  audit: AuditRepository;
}
