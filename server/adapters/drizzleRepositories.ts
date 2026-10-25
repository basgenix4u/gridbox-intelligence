import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type * as schema from "../../db/schema.js";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js/session";
import type { PgliteQueryResultHKT } from "drizzle-orm/pglite/session";
import { auditLog, leaderboardDaily, legacyScores, nameReports, players, runs } from "../../db/schema.js";
import type {
  AuditRepository,
  DailyBoardEntry,
  LegacyScoreRepository,
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

/**
 * Both drivers the adapters run against: the production Neon pooler
 * (postgres-js) and PGlite in the integration tests. The SQL is identical;
 * only the query-result wrapper differs, which `rowsOf` normalises.
 */
type SupportedDatabase = PgDatabase<PostgresJsQueryResultHKT | PgliteQueryResultHKT, typeof schema>;

const HELD_NAMES_EXCLUDE = sql`NOT EXISTS (
  SELECT 1 FROM gridbox.name_reports nr
  WHERE nr.reported_player_id = r.player_id AND nr.status = 'pending'
)`;

/**
 * The SQLSTATE of a failed query, unwrapping the driver-specific wrappers:
 * postgres-js puts `code` on the error itself, PGlite nests the pg error under
 * `cause`. Without the walk, a unique-violation looks like an unknown error
 * and the replay guard silently stops working.
 */
function sqlState(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth++) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

/**
 * drizzle's `execute()` result shape is driver-specific: postgres-js hands back
 * the row array, PGlite a `{ rows }` result object. Normalising once here keeps
 * every query below reading the same, and is what let the integration suite
 * catch the difference against a real Postgres.
 */
async function rowsOf<T>(query: Promise<unknown>): Promise<T[]> {
  const result = await query;
  if (Array.isArray(result)) return result as T[];
  if (result !== null && typeof result === "object" && "rows" in result) {
    const rows = result.rows;
    return Array.isArray(rows) ? (rows as T[]) : [];
  }
  return [];
}

interface BoardRow {
  playerId: string;
  initials: string;
  score: number;
  level: number;
  /** Required by drizzle's `execute<TRow extends Record<string, unknown>>`. */
  [key: string]: unknown;
}

const playerRepo = (db: SupportedDatabase): PlayerRepository => ({
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
  async addRunTotals(id, score, runs = 1) {
    const rows = await db
      .update(players)
      .set({
        totalRuns: sql`${players.totalRuns} + ${runs}`,
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

const runRepo = (db: SupportedDatabase): RunRepository => ({
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
      if (sqlState(err) === "23505") {
        throw new DuplicateRunError();
      }
      throw err;
    }
  },
  async setValidity(id, validity: RunValidity) {
    await db.update(runs).set({ validity }).where(eq(runs.id, id));
  },
  async globalBoard(mode: RunMode, limit: number): Promise<LeaderboardEntry[]> {
    const rows = await rowsOf<BoardRow>(
      db.execute<BoardRow>(sql`
      SELECT DISTINCT ON (r.player_id)
        r.player_id AS "playerId", p.initials, r.score, r.level
      FROM gridbox.runs r
      JOIN gridbox.players p ON p.id = r.player_id
      WHERE r.mode = ${mode} AND r.validity = 'ok' AND ${HELD_NAMES_EXCLUDE}
      ORDER BY r.player_id, r.score DESC
    `),
    );
    return [...rows]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => ({ playerId: r.playerId, initials: r.initials, score: Number(r.score), level: Number(r.level) }));
  },
  async around(playerId: string, mode: RunMode, span: number) {
    const rows = await rowsOf<BoardRow & { rank: number }>(
      db.execute<BoardRow & { rank: number }>(sql`
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
    `),
    );
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
    const rows = await rowsOf<{ playerId: string; initials: string; score: number; level: number }>(
      db.execute<{ playerId: string; initials: string; score: number; level: number }>(sql`
      SELECT d.player_id AS "playerId", d.initials, d.score, d.level
      FROM gridbox.leaderboard_daily d
      WHERE d.day = ${day} AND d.mode = ${mode}
        AND NOT EXISTS (
          SELECT 1 FROM gridbox.name_reports nr
          WHERE nr.reported_player_id = d.player_id AND nr.status = 'pending'
        )
      ORDER BY d.score DESC
        LIMIT ${limit}
      `),
    );
    return [...rows].map((r) => ({
      playerId: r.playerId,
      initials: r.initials,
      score: Number(r.score),
      level: Number(r.level ?? 0),
    }));
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
        level: input.level,
        rank: 1,
      })
      .onConflictDoUpdate({
        target: [leaderboardDaily.day, leaderboardDaily.mode, leaderboardDaily.playerId],
        set: {
          score: sql`greatest(${leaderboardDaily.score}, ${input.score})`,
          initials: input.initials,
          // The level belongs to the run that set the best score, so it moves
          // only when a strictly better score arrives. A tie keeps the
          // incumbent's level rather than silently adopting the newcomer's.
          level: sql`CASE WHEN ${input.score} > ${leaderboardDaily.score} THEN ${input.level} ELSE ${leaderboardDaily.level} END`,
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

const reportRepo = (db: SupportedDatabase): ReportRepository => ({
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

const auditRepo = (db: SupportedDatabase): AuditRepository => ({
  async log(entry) {
    await db.insert(auditLog).values({ actor: entry.actor, action: entry.action, meta: entry.meta });
  },
  async list(limit) {
    const rows = await db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(limit);
    return rows.map((row) => ({
      id: row.id,
      actor: row.actor,
      action: row.action,
      meta: row.meta,
      at: row.at,
    }));
  },
});

const legacyScoreRepo = (db: SupportedDatabase): LegacyScoreRepository => ({
  async insertMany(playerId, entries) {
    if (entries.length === 0) return { inserted: 0 };
    // ON CONFLICT DO NOTHING is the idempotence: the unique (player, client_id)
    // index makes a retried upload a no-op, and the returned row count is
    // exactly how many entries were new.
    const inserted = await db
      .insert(legacyScores)
      .values(
        entries.map((e) => ({
          playerId,
          clientId: e.clientId,
          score: e.score,
          level: e.level,
          chips: e.chips,
          maxCombo: e.maxCombo,
          playedAt: e.playedAt,
          scoringVersion: e.scoringVersion,
        })),
      )
      .onConflictDoNothing({ target: [legacyScores.playerId, legacyScores.clientId] })
      .returning({ id: legacyScores.id });
    return { inserted: inserted.length };
  },
  async list(playerId, limit) {
    const rows = await db
      .select()
      .from(legacyScores)
      .where(eq(legacyScores.playerId, playerId))
      .orderBy(desc(legacyScores.score), asc(legacyScores.playedAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      playerId: r.playerId,
      clientId: r.clientId,
      score: r.score,
      level: r.level,
      chips: r.chips,
      maxCombo: r.maxCombo,
      playedAt: Number(r.playedAt),
      scoringVersion: r.scoringVersion,
      migratedAt: r.migratedAt,
    }));
  },
  async hasAny(playerId) {
    const rows = await db
      .select({ id: legacyScores.id })
      .from(legacyScores)
      .where(eq(legacyScores.playerId, playerId))
      .limit(1);
    return rows.length > 0;
  },
});

export function createDrizzleRepositories(db: SupportedDatabase): Repositories {
  return {
    players: playerRepo(db),
    runs: runRepo(db),
    reports: reportRepo(db),
    audit: auditRepo(db),
    legacyScores: legacyScoreRepo(db),
  };
}
