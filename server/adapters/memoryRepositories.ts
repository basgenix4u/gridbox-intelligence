/* eslint-disable @typescript-eslint/require-await -- Port interfaces are async by contract; in-memory adapters resolve synchronously, and services must not be able to tell a memory adapter from a database one. */
import type {
  AuditRecord,
  AuditRepository,
  DailyBoardEntry,
  LeaderboardEntry,
  NameReportRecord,
  NewRun,
  PlayerRecord,
  PlayerRepository,
  ReportRepository,
  Repositories,
  RunRecord,
  RunRepository,
} from "../ports/repositories.js";
import type { RunMode, RunValidity } from "../../src/shared/contracts.js";

/**
 * In-memory repository adapters.
 *
 * Two jobs: fast, deterministic integration tests for the services and routes,
 * and a working local development mode with no database. The behaviour mirrors
 * the Drizzle adapters, including the "held for moderation" board rule — the
 * same queries the services make must return the same answers.
 *
 * Single-process only: no persistence, no locking. Production runs on the
 * Drizzle adapters.
 */
export function createMemoryRepositories(): Repositories {
  const players = new Map<string, PlayerRecord>();
  const runs = new Map<string, RunRecord>();
  const daily = new Map<string, DailyBoardEntry & { day: string; mode: RunMode }>();
  const reports = new Map<number, NameReportRecord>();
  const audit: AuditRecord[] = [];
  let nextReportId = 1;

  const playerRepo: PlayerRepository = {
    async findByTokenHash(anonTokenHash) {
      for (const p of players.values()) if (p.anonTokenHash === anonTokenHash) return p;
      return null;
    },
    async findById(id) {
      return players.get(id) ?? null;
    },
    async create(input) {
      const now = new Date();
      const record: PlayerRecord = {
        id: input.id,
        anonTokenHash: input.anonTokenHash,
        displayName: input.displayName,
        initials: input.initials,
        createdAt: now,
        lastSeenAt: now,
        totalRuns: 0,
        bestScore: 0,
      };
      players.set(record.id, record);
      return record;
    },
    async touch(id) {
      const p = players.get(id);
      if (p) p.lastSeenAt = new Date();
    },
    async updateName(id, name) {
      const p = players.get(id);
      if (!p) throw new Error(`player ${id} not found`);
      p.displayName = name.displayName;
      p.initials = name.initials;
      return p;
    },
    async addRunTotals(id, score) {
      const p = players.get(id);
      if (!p) throw new Error(`player ${id} not found`);
      p.totalRuns += 1;
      p.bestScore = Math.max(p.bestScore, score);
      return p;
    },
  };

  const heldPlayerIds = async (): Promise<Set<string>> => {
    const held = new Set<string>();
    for (const r of reports.values()) {
      if (r.status === "pending") held.add(r.reportedPlayerId);
    }
    return held;
  };

  const runRepo: RunRepository = {
    async findById(id) {
      return runs.get(id) ?? null;
    },
    async insert(run: NewRun) {
      if (runs.has(run.id)) throw new Error("duplicate run id");
      const record: RunRecord = { ...run, submittedAt: new Date() };
      runs.set(record.id, record);
      return record;
    },
    async setValidity(id, validity: RunValidity) {
      const r = runs.get(id);
      if (r) r.validity = validity;
    },
    async globalBoard(mode: RunMode, limit: number): Promise<LeaderboardEntry[]> {
      const held = await heldPlayerIds();
      const best = new Map<string, LeaderboardEntry>();
      for (const r of runs.values()) {
        if (r.mode !== mode || r.validity !== "ok") continue;
        if (held.has(r.playerId)) continue;
        const player = players.get(r.playerId);
        if (!player) continue;
        const current = best.get(r.playerId);
        if (!current || r.score > current.score) {
          best.set(r.playerId, { playerId: r.playerId, initials: player.initials, score: r.score, level: r.level });
        }
      }
      return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    },
    async around(playerId: string, mode: RunMode, span: number) {
      const board = await runRepo.globalBoard(mode, Number.MAX_SAFE_INTEGER);
      const index = board.findIndex((r) => r.playerId === playerId);
      if (index < 0) return { rank: null, rows: [] };
      const from = Math.max(0, index - span);
      const to = Math.min(board.length, index + span + 1);
      return { rank: index + 1, rows: board.slice(from, to) };
    },
    async dailyBoard(day: string, mode: RunMode, limit: number): Promise<DailyBoardEntry[]> {
      const held = await heldPlayerIds();
      const rows: DailyBoardEntry[] = [];
      for (const entry of daily.values()) {
        if (entry.day !== day || entry.mode !== mode) continue;
        if (held.has(entry.playerId)) continue;
        rows.push({ playerId: entry.playerId, initials: entry.initials, score: entry.score });
      }
      return rows.sort((a, b) => b.score - a.score).slice(0, limit);
    },
    async upsertDailyBest(input) {
      const key = `${input.day}|${input.mode}|${input.playerId}`;
      const existing = daily.get(key);
      if (!existing || input.score > existing.score) {
        daily.set(key, { ...input });
      }
    },
  };

  const reportRepo: ReportRepository = {
    async create(input) {
      const record: NameReportRecord = {
        id: nextReportId++,
        reporterPlayerId: input.reporterPlayerId,
        reportedPlayerId: input.reportedPlayerId,
        reportedName: input.reportedName,
        reason: input.reason,
        status: "pending",
        createdAt: new Date(),
      };
      reports.set(record.id, record);
      return record;
    },
    async listPending(limit) {
      return [...reports.values()]
        .filter((r) => r.status === "pending")
        .sort((a, b) => a.id - b.id)
        .slice(0, limit);
    },
    async resolve(id, status, actor) {
      const record = reports.get(id);
      if (!record) return null;
      record.status = status;
      audit.push({
        id: audit.length + 1,
        actor,
        action: `moderation.${status}`,
        meta: { reportId: id },
        at: new Date(),
      });
      return record;
    },
    async hasPendingReport(playerId) {
      for (const r of reports.values()) {
        if (r.reportedPlayerId === playerId && r.status === "pending") return true;
      }
      return false;
    },
  };

  const auditRepo: AuditRepository = {
    async log(entry) {
      audit.push({ id: audit.length + 1, actor: entry.actor, action: entry.action, meta: entry.meta, at: new Date() });
    },
    async list(limit) {
      return audit.slice(-limit).reverse();
    },
  };

  return { players: playerRepo, runs: runRepo, reports: reportRepo, audit: auditRepo };
}
