import { describe, expect, it } from "vitest";
import {
  AnonymousAuthRequestSchema,
  AuthResponseSchema,
  DisplayNameSchema,
  InitialsSchema,
  LeaderboardResponseSchema,
  ModerationQueueResponseSchema,
  ModerationResolveRequestSchema,
  NameReportRequestSchema,
  PlayerSchema,
  RunAttestationSchema,
  RunModeSchema,
  RunStartRequestSchema,
  RunStartResponseSchema,
  RunSubmitRequestSchema,
  RunSubmitResponseSchema,
  UpdateMeRequestSchema,
} from "./contracts.js";

describe("RunModeSchema", () => {
  it("accepts the shipped modes", () => {
    expect(RunModeSchema.parse("endless")).toBe("endless");
    expect(RunModeSchema.parse("daily")).toBe("daily");
    expect(RunModeSchema.safeParse("ranked").success).toBe(false);
  });
});

describe("DisplayNameSchema", () => {
  it("accepts 2–16 characters of letters, numbers and light punctuation", () => {
    expect(DisplayNameSchema.parse("  Bo  ")).toBe("Bo");
    expect(DisplayNameSchema.parse("Grid-Box_42")).toBe("Grid-Box_42");
    expect(DisplayNameSchema.parse("A".repeat(16))).toHaveLength(16);
  });

  it("rejects empty, single-character, overlong and symbol-heavy names", () => {
    expect(DisplayNameSchema.safeParse("").success).toBe(false);
    expect(DisplayNameSchema.safeParse("A").success).toBe(false);
    expect(DisplayNameSchema.safeParse("A".repeat(17)).success).toBe(false);
    expect(DisplayNameSchema.safeParse("bad name!").success).toBe(false);
  });
});

describe("InitialsSchema", () => {
  it("accepts exactly three uppercase alphanumerics", () => {
    expect(InitialsSchema.parse("ABC")).toBe("ABC");
    expect(InitialsSchema.parse("A1B")).toBe("A1B");
  });

  it("rejects wrong lengths, lowercase and separators", () => {
    expect(InitialsSchema.safeParse("AB").success).toBe(false);
    expect(InitialsSchema.safeParse("ABCD").success).toBe(false);
    expect(InitialsSchema.safeParse("abc").success).toBe(false);
    expect(InitialsSchema.safeParse("A-B").success).toBe(false);
  });
});

describe("PlayerSchema", () => {
  it("parses a full player record", () => {
    const parsed = PlayerSchema.parse({
      id: "11111111-2222-4333-8444-555555555555",
      displayName: "Nova",
      initials: "NOV",
      bestScore: 12_000,
      totalRuns: 3,
      createdAt: "2026-10-24T10:00:00.000Z",
    });
    expect(parsed.bestScore).toBe(12_000);
  });

  it("rejects a non-uuid id and negative scores", () => {
    expect(PlayerSchema.safeParse({ ...base, id: "nope" }).success).toBe(false);
    expect(PlayerSchema.safeParse({ ...base, bestScore: -1 }).success).toBe(false);
  });
});

const base = {
  id: "11111111-2222-4333-8444-555555555555",
  displayName: "Nova",
  initials: "NOV",
  bestScore: 0,
  totalRuns: 0,
  createdAt: "2026-10-24T10:00:00.000Z",
};

describe("AnonymousAuthRequestSchema", () => {
  it("takes an optional display name", () => {
    expect(AnonymousAuthRequestSchema.parse({}).displayName).toBeUndefined();
    expect(AnonymousAuthRequestSchema.parse({ displayName: "Nova" }).displayName).toBe("Nova");
    expect(AnonymousAuthRequestSchema.safeParse({ displayName: "x" }).success).toBe(false);
  });
});

describe("AuthResponseSchema", () => {
  it("parses a token plus player", () => {
    const parsed = AuthResponseSchema.parse({ token: "jwt", player: base });
    expect(parsed.player.initials).toBe("NOV");
  });
});

describe("UpdateMeRequestSchema", () => {
  it("requires at least one field", () => {
    expect(UpdateMeRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateMeRequestSchema.parse({ displayName: "Vega" }).displayName).toBe("Vega");
    expect(UpdateMeRequestSchema.parse({ initials: "VEG" }).initials).toBe("VEG");
  });

  it("validates both fields", () => {
    expect(UpdateMeRequestSchema.safeParse({ initials: "toolong" }).success).toBe(false);
    expect(UpdateMeRequestSchema.safeParse({ displayName: "a" }).success).toBe(false);
  });
});

describe("RunStartRequestSchema", () => {
  it("defaults the mode to endless and requires a client version", () => {
    expect(RunStartRequestSchema.parse({ clientVersion: "0.1.0" }).mode).toBe("endless");
    expect(RunStartRequestSchema.parse({ mode: "daily", clientVersion: "0.1.0" }).mode).toBe("daily");
    expect(RunStartRequestSchema.safeParse({ mode: "weekly", clientVersion: "0.1.0" }).success).toBe(false);
    expect(RunStartRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("RunStartResponseSchema", () => {
  it("parses a start response", () => {
    const parsed = RunStartResponseSchema.parse({
      runId: "11111111-2222-4333-8444-555555555555",
      seed: 42,
      nonce: "n".repeat(32),
      mode: "endless",
      day: "2026-10-24",
      startToken: "t".repeat(40),
    });
    expect(parsed.seed).toBe(42);
    expect(parsed.day).toBe("2026-10-24");
  });
});

describe("RunAttestationSchema", () => {
  it("requires a nonce and at least one 64-hex link", () => {
    expect(RunAttestationSchema.parse({ nonce: "n".repeat(32), chain: ["a".repeat(64)] }).chain).toHaveLength(1);
    expect(RunAttestationSchema.safeParse({ nonce: "n", chain: [] }).success).toBe(false);
    expect(RunAttestationSchema.safeParse({ nonce: "n".repeat(32), chain: ["not-hex"] }).success).toBe(false);
  });
});

describe("RunSubmitRequestSchema", () => {
  const valid = {
    startToken: "a".repeat(40),
    score: 12_000,
    level: 22,
    chips: 150,
    kills: 20,
    maxCombo: 8,
    durationMs: 60_000,
    clientVersion: "0.1.0",
    attestation: { nonce: "n".repeat(32), chain: ["c".repeat(64)] },
  };

  it("accepts a well-formed submission", () => {
    expect(RunSubmitRequestSchema.parse(valid).score).toBe(12_000);
  });

  it("rejects out-of-range and fractional metrics", () => {
    expect(RunSubmitRequestSchema.safeParse({ ...valid, score: -1 }).success).toBe(false);
    expect(RunSubmitRequestSchema.safeParse({ ...valid, score: 2_000_000 }).success).toBe(false);
    expect(RunSubmitRequestSchema.safeParse({ ...valid, level: 1.5 }).success).toBe(false);
    expect(RunSubmitRequestSchema.safeParse({ ...valid, level: 101 }).success).toBe(false);
    expect(RunSubmitRequestSchema.safeParse({ ...valid, maxCombo: 9 }).success).toBe(false);
    expect(RunSubmitRequestSchema.safeParse({ ...valid, durationMs: 10 }).success).toBe(false);
  });

  it("rejects a missing attestation", () => {
    expect(RunSubmitRequestSchema.safeParse({ ...valid, attestation: undefined }).success).toBe(false);
  });
});

describe("RunSubmitResponseSchema", () => {
  it("parses an accepted verdict with a rank", () => {
    const parsed = RunSubmitResponseSchema.parse({ accepted: true, validity: "ok", rank: 1, bestScore: 12_000 });
    expect(parsed.rank).toBe(1);
  });

  it("parses a suspect verdict with a null rank", () => {
    const parsed = RunSubmitResponseSchema.parse({ accepted: false, validity: "suspect", rank: null, bestScore: 0 });
    expect(parsed.accepted).toBe(false);
    expect(parsed.rank).toBeNull();
  });

  it("rejects an unknown validity", () => {
    expect(
      RunSubmitResponseSchema.safeParse({ accepted: true, validity: "cheat", rank: 1, bestScore: 0 }).success,
    ).toBe(false);
  });
});

describe("LeaderboardResponseSchema", () => {
  it("parses a global board", () => {
    const parsed = LeaderboardResponseSchema.parse({
      scope: "global",
      mode: "endless",
      day: null,
      rows: [
        {
          rank: 1,
          playerId: "11111111-2222-4333-8444-555555555555",
          initials: "NOV",
          score: 100,
          level: 3,
          isYou: true,
        },
      ],
    });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.day).toBeNull();
  });

  it("parses a daily board with a day", () => {
    const parsed = LeaderboardResponseSchema.parse({
      scope: "daily",
      mode: "daily",
      day: "2026-10-24",
      rows: [],
    });
    expect(parsed.day).toBe("2026-10-24");
  });
});

describe("moderation contracts", () => {
  it("parses a report request with a required reason", () => {
    expect(NameReportRequestSchema.parse({ reason: "offensive" }).reason).toBe("offensive");
    expect(NameReportRequestSchema.safeParse({}).success).toBe(false);
    expect(NameReportRequestSchema.safeParse({ reason: "   " }).success).toBe(false);
    expect(NameReportRequestSchema.safeParse({ reason: "x".repeat(281) }).success).toBe(false);
  });

  it("parses the queue and the resolve request", () => {
    const queue = ModerationQueueResponseSchema.parse({
      rows: [
        {
          id: 1,
          reportedPlayerId: "11111111-2222-4333-8444-555555555555",
          reportedName: "Badname",
          reason: "offensive",
          status: "open",
          createdAt: "2026-10-24T10:00:00.000Z",
        },
      ],
    });
    expect(queue.rows[0].reportedName).toBe("Badname");
    expect(ModerationResolveRequestSchema.parse({ action: "uphold" }).action).toBe("uphold");
    expect(ModerationResolveRequestSchema.safeParse({ action: "ignore" }).success).toBe(false);
  });
});
