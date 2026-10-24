import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { players, runs, nameReports, auditLog, leaderboardDaily } from "../../db/schema.js";
import type {
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
 * Drizzle repository adapters — the production persistence.
 *
 * Thin by design: every method is one query against the `gridbox` schema, with
 * the "held for moderation" rule enforced in SQL (a pending report removes the
 * player from every board, so a reported name cannot leak through a missed
 * application-side check).
 *
 * The board queries use DISTINCT ON / window functions — best-per-player and
 * rank are set operations, and Postgres does them better than Node can.
 */

const HELD_NAMES_EXCLUDE = sql`NOT EXISTS (
  SELECT 1 FROM gridbox.name_reports nr
  WHERE nr.reported_player_id = r.player_id AND nr.status = 'pending'
)`;

interface BoardRow {
  playerId: string;
  initials: string;
  score: number;
  level: number;
  /** Required by drizzle's `execute<TRow extends Record<string, unknown>>`. */
  [key: string]: unknown;
}

const playerRepo = (db: Database): PlayerRepository => ({
  async findByTokenHash(anonTokenHash) {
    const rows = await db.select().from(players).where(eq(players.anonTokenHash, anonTokenHash)).limit(1);
    return rows[0] ? toPlayerRecord(rows[0]) : null;
  },
  async findById(id) {
    const rows = await db.select().from(players).where(eq(players.id, id)).limit(1);
    return rows[0] ? toPlayerRecord(rows[0]) : null;
  },
  async create(input) {
    const rows = await db
      .insert(players)
      .values({
        id: input.id,
        anonTokenHash: input.anonTokenHash,
        displayName: input.displayName,
        initials: input.initials,
      })
      .returning();
    return toPlayerRecord(rows[0]);
  },
  async touch(id) {
    await db.update(players).set({ lastSeenAt: new Date() }).where(eq(players.id, id));
  },
  async updateName(id, name) {
    const rows = await db
      .update(players)
      .set({ displayName: name.displayName, initials: name.initials })
      .where(eq(players.id, id))
      .returning();
    if (!rows[0]) throw new Error(`player ${id} not found`);
    return toPlayerRecord(rows[0]);
  },
  async addRunTotals(id, score) {
    const rows = await db
      .update(players)
      .set({
        totalRuns: sql`${players.totalRuns} + 1`,
        bestScore: sql`greatest(${players.bestScore}, ${score})`,
      })
      .where(eq(players.id, id))
      .returning();
    if (!rows[0]) throw new Error(`player ${id} not found`);
    return toPlayerRecord(rows[0]);
  },
});

function toPlayerRecord(row: typeof players.$inferSelect): PlayerRecord {
  return {
    id: row.id,
    anonTokenHash: row.anonTokenHash,
    displayName: row.displayName,
    initials: row.initials,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    totalRuns: row.totalRuns,
    bestScore: row.bestScore,
  };
}

const runRepo = (db: Database): RunRepository => ({
  async findById(id) {
    const rows = await db.select().from(runs).where(eq(runs.id, id)).limit(1);
    return rows[0] ? toRunRecord(rows[0]) : null;
  },
  async insert(run: NewRun) {
    try {
      const rows = await db
        .insert(runs)
        .values({
          id: run.id,
          playerId: run.playerId,
          mode: run.mode,
          seed: run.seed,
          day: run.day,
          score: run.score,
          level: run.level,
          chips: run.chips,
          maxCombo: run.maxCombo,
          kills: run.kills,
          durationMs: run.durationMs,
          clientVersion: run.clientVersion,
          attestation: run.attestation,
          validity: run.validity,
          scoringVersion: run.scoringVersion,
        })
        .returning();
      return toRunRecord(rows[0]);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new DuplicateRunError();
      }
      throw err;
    }
  },
  async setValidity(id, validity: RunValidity) {
    await db.update(runs).set({ validity }).where(eq(runs.id, id));
  },
  async globalBoard(mode: RunMode, limit: number): Promise<LeaderboardEntry[]> {
    const rows = await db.execute<BoardRow>(sql`
      SELECT DISTINCT ON (r.player_id)
        r.player_id AS "playerId", p.initials, r.score, r.level
      FROM gridbox.runs r
      JOIN gridbox.players p ON p.id = r.player_id
      WHERE r.mode = ${mode} AND r.validity = 'ok' AND ${HELD_NAMES_EXCLUDE}
      ORDER BY r.player_id, r.score DESC
    `);
    return [...rows]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => ({ playerId: r.playerId, initials: r.initials, score: Number(r.score), level: Number(r.level) }));
  },
  async around(playerId: string, mode: RunMode, span: number) {
    const rows = await db.execute<BoardRow & { rank: number }>(sql`
      WITH best AS (
        SELECT DISTINCT ON (r.player_id) r.player_id, r.score, r.level
        FROM gridbox.runs r
        WHERE r.mode = ${mode} AND r.validity = 'ok' AND ${HELD_NAMES_EXCLUDE}
        ORDER BY r.player_id, r.score DESC
      ), ranked AS (
        SELECT b.player_id AS "playerId", p.initials, b.score, b.level,
               rank() OVER (ORDER BY b.score DESC) AS rank
        FROM best b JOIN gridbox.players p ON p.id = b.player_id
      )
      SELECT * FROM ranked WHERE "rank" BETWEEN (
        SELECT COALESCE(MIN(rank), 1) FROM ranked WHERE "playerId" = ${playerId}
      ) - ${span} AND (
        SELECT COALESCE(MAX(rank), 1) FROM ranked WHERE "playerId" = ${playerId}
      ) + ${span}
      ORDER BY "rank"
    `);
    const mine = rows.find((r) => r.playerId === playerId);
    return {
      rank: mine ? Number(mine.rank) : null,
      rows: rows.map((r) => ({
        playerId: r.playerId,
        initials: r.initials,
        score: Number(r.score),
        level: Number(r.level),
      })),
    };
  },
  async dailyBoard(day: string, mode: RunMode, limit: number): Promise<DailyBoardEntry[]> {
    const rows = await db.execute<{ playerId: string; initials: string; score: number }>(sql`
      SELECT d.player_id AS "playerId", d.initials, d.score
      FROM gridbox.leaderboard_daily d
      WHERE d.day = ${day} AND d.mode = ${mode}
        AND NOT EXISTS (
          SELECT 1 FROM gridbox.name_reports nr
          WHERE nr.reported_player_id = d.player_id AND nr.status = 'pending'
        )
      ORDER BY d.score DESC
      LIMIT ${limit}
    `);
    return [...rows].map((r) => ({ playerId: r.playerId, initials: r.initials, score: Number(r.score) }));
  },
  async upsertDailyBest(input) {
    await db
      .insert(leaderboardDaily)
      .values({
        day: input.day,
        mode: input.mode,
        playerId: input.playerId,
        initials: input.initials,
        score: input.score,
        rank: 1,
      })
      .onConflictDoUpdate({
        target: [leaderboardDaily.day, leaderboardDaily.mode, leaderboardDaily.playerId],
        set: {
          score: sql`greatest(${leaderboardDaily.score}, ${input.score})`,
          initials: input.initials,
        },
      });
  },
});

function toRunRecord(row: typeof runs.$inferSelect): RunRecord {
  return {
    id: row.id,
    playerId: row.playerId,
    mode: row.mode,
    seed: Number(row.seed),
    day: row.day,
    score: row.score,
    level: row.level,
    chips: row.chips,
    maxCombo: row.maxCombo,
    kills: row.kills,
    durationMs: row.durationMs,
    clientVersion: row.clientVersion,
    attestation: row.attestation,
    validity: row.validity,
    scoringVersion: row.scoringVersion,
    submittedAt: row.submittedAt,
  };
}

/** A run id collision — the service maps this to a 409. */
export class DuplicateRunError extends Error {
  constructor() {
    super("duplicate run id");
    this.name = "DuplicateRunError";
  }
}

const reportRepo = (db: Database): ReportRepository => ({
  async create(input) {
    const rows = await db
      .insert(nameReports)
      .values({
        reporterPlayerId: input.reporterPlayerId,
        reportedPlayerId: input.reportedPlayerId,
        reportedName: input.reportedName,
        reason: input.reason,
      })
      .returning();
    return toReportRecord(rows[0]);
  },
  async listPending(limit) {
    const rows = await db
      .select()
      .from(nameReports)
      .where(eq(nameReports.status, "pending"))
      .orderBy(nameReports.id)
      .limit(limit);
    return rows.map(toReportRecord);
  },
  async resolve(id, status, actor) {
    const rows = await db
      .update(nameReports)
      .set({ status })
      .where(and(eq(nameReports.id, id), eq(nameReports.status, "pending")))
      .returning();
    if (!rows[0]) return null;
    await db.insert(auditLog).values({ actor, action: `moderation.${status}`, meta: { reportId: id } });
    return toReportRecord(rows[0]);
  },
  async hasPendingReport(playerId) {
    const rows = await db
      .select({ id: nameReports.id })
      .from(nameReports)
      .where(and(eq(nameReports.reportedPlayerId, playerId), eq(nameReports.status, "pending")))
      .limit(1);
    return rows.length > 0;
  },
});

function toReportRecord(row: typeof nameReports.$inferSelect): NameReportRecord {
  return {
    id: row.id,
    reporterPlayerId: row.reporterPlayerId,
    reportedPlayerId: row.reportedPlayerId,
    reportedName: row.reportedName,
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt,
  };
}

const auditRepo = (db: Database): AuditRepository => ({
  async log(entry) {
    await db.insert(auditLog).values({ actor: entry.actor, action: entry.action, meta: entry.meta });
  },
});

export function createDrizzleRepositories(db: Database): Repositories {
  return { players: playerRepo(db), runs: runRepo(db), reports: reportRepo(db), audit: auditRepo(db) };
}
