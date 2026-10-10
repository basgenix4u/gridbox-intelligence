/**
 * Development seeder. Populates the leaderboard with plausible demo runs so the
 * UI can be built and reviewed against realistic data before real players exist.
 *
 * Safe to re-run: it clears only rows whose `client_version` is `seed`.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/seed.ts
 */
import { createHash, randomUUID } from "node:crypto";
import { config } from "dotenv";
import { sql } from "drizzle-orm";

config({ path: ".env.local" });
config(); // .env

const SEED_TAG = "seed";

const NAMES = ["ACE", "BIT", "BYT", "CYB", "DAT", "EXE", "GLT", "HEX", "ION", "NEO"];

async function main(): Promise<void> {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Set DATABASE_URL (or DIRECT_URL) before running the seeder.");
  }

  const { createDatabase } = await import("../db/client.js");
  const { players, runs } = await import("../db/schema.js");
  const db = createDatabase(url);

  console.log("Clearing previous seed rows…");
  await db.delete(runs).where(sql`${runs.clientVersion} = ${SEED_TAG}`);
  await db.delete(players).where(sql`${players.initials} = any(${NAMES})`);

  console.log("Inserting demo players…");
  const inserted = await db
    .insert(players)
    .values(
      NAMES.map((name, i) => ({
        anonTokenHash: createHash("sha256").update(`seed-${name}`).digest("hex"),
        displayName: name,
        initials: name,
        totalRuns: 0,
        bestScore: 0,
        createdAt: new Date(Date.now() - (i + 1) * 86_400_000),
        lastSeenAt: new Date(),
      })),
    )
    .returning({ id: players.id, initials: players.initials });

  console.log(`Inserting demo runs for ${inserted.length} players…`);
  const rows = inserted.flatMap((player, pi) =>
    Array.from({ length: 3 }, (_, ri) => {
      const skill = (10 - pi) / 10; // earlier players are "better"
      const score = Math.round((3_000 + ri * 900) * skill + 500);
      return {
        playerId: player.id,
        mode: "endless" as const,
        seed: Math.floor(Math.random() * 0xffffffff),
        day: new Date().toISOString().slice(0, 10),
        score,
        level: Math.max(1, Math.round(score / 520)),
        chips: Math.round(score / 80),
        maxCombo: 8,
        kills: Math.round(score / 800),
        durationMs: 20_000 + ri * 4_000,
        clientVersion: SEED_TAG,
        validity: "ok" as const,
        scoringVersion: 2,
        submittedAt: new Date(Date.now() - ri * 3_600_000),
        id: randomUUID(),
      };
    }),
  );
  await db.insert(runs).values(rows);

  const total = await db.select({ n: sql<number>`count(*)::int` }).from(runs);
  console.log(`Seed complete. runs table now holds ${total[0]?.n ?? 0} rows.`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
