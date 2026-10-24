import { z } from "zod";

/**
 * The API contract — the single source of truth for request and response
 * shapes, shared by the server (validation) and the client (typed fetch).
 *
 * The client imports *types only* from this module, so Zod never enters the
 * browser bundle (type-only imports are erased under `verbatimModuleSyntax`).
 * The server imports the schemas and validates every request against them:
 * nothing hand-parsed, nothing trusted.
 */

export const RUN_MODES = ["endless", "daily", "zen", "hardcore"] as const;
export const RunModeSchema = z.enum(RUN_MODES);
export type RunMode = z.infer<typeof RunModeSchema>;

export const RUN_VALIDITIES = ["ok", "suspect", "rejected"] as const;
export const RunValiditySchema = z.enum(RUN_VALIDITIES);
export type RunValidity = z.infer<typeof RunValiditySchema>;

/** Current scoring formula version. Legacy local history is version 1. */
export const CURRENT_SCORING_VERSION = 2;

// --------------------------------------------------------------- players

/**
 * Long display name: letters, numbers, spaces and a little punctuation, 2–16
 * characters. The profanity filter runs on top of this (see server/names.ts).
 */
export const DisplayNameSchema = z
  .string()
  .trim()
  .min(2, "Display name must be at least 2 characters")
  .max(16, "Display name must be at most 16 characters")
  .regex(/^[\p{L}\p{N} _.-]+$/u, "Display name may only contain letters, numbers, spaces, dots, dashes");

/** Three uppercase alphanumerics, as shown in compact leaderboard rows. */
export const InitialsSchema = z
  .string()
  .trim()
  .length(3, "Initials must be exactly 3 characters")
  .regex(/^[A-Z0-9]{3}$/, "Initials may only contain A–Z and 0–9");

export const PlayerSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  initials: z.string(),
  bestScore: z.number().int().nonnegative(),
  totalRuns: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type Player = z.infer<typeof PlayerSchema>;

// --------------------------------------------------------------- auth

export const AnonymousAuthRequestSchema = z.object({
  displayName: DisplayNameSchema.optional(),
});
export type AnonymousAuthRequest = z.infer<typeof AnonymousAuthRequestSchema>;

export const AuthResponseSchema = z.object({
  token: z.string(),
  player: PlayerSchema,
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const UpdateMeRequestSchema = z
  .object({
    displayName: DisplayNameSchema.optional(),
    initials: InitialsSchema.optional(),
  })
  .refine((v) => v.displayName !== undefined || v.initials !== undefined, {
    message: "Provide a displayName and/or initials to update",
  });
export type UpdateMeRequest = z.infer<typeof UpdateMeRequestSchema>;

// --------------------------------------------------------------- runs

export const RunStartRequestSchema = z.object({
  mode: RunModeSchema.default("endless"),
  clientVersion: z.string().trim().min(1).max(32),
});
export type RunStartRequest = z.infer<typeof RunStartRequestSchema>;

export const RunStartResponseSchema = z.object({
  runId: z.uuid(),
  /** The seed the client must play with — server-issued, so daily is fair. */
  seed: z.number().int(),
  /** Opening link of the attestation chain; the client hashes forward from it. */
  nonce: z.string(),
  mode: RunModeSchema,
  /** UTC calendar day the run counts against (YYYY-MM-DD). */
  day: z.string(),
  /** Short-lived signed proof that this server issued this run. */
  startToken: z.string(),
});
export type RunStartResponse = z.infer<typeof RunStartResponseSchema>;

export const RunAttestationSchema = z.object({
  /** Must equal the nonce issued at /runs/start. */
  nonce: z.string().min(8).max(128),
  /**
   * Hash chain proving a real game loop ran: chain[i] = sha256(chain[i-1]:i)
   * with chain[-1] = nonce. The server recomputes it; a replayer cannot forge
   * it without the nonce, and the nonce is bound to this run by startToken.
   */
  chain: z
    .array(z.string().regex(/^[0-9a-f]{64}$/))
    .min(1)
    .max(60_000),
});
export type RunAttestation = z.infer<typeof RunAttestationSchema>;

export const RunSubmitRequestSchema = z.object({
  startToken: z.string().min(1),
  score: z.number().int().min(0).max(1_000_000),
  level: z.number().int().min(1).max(100),
  chips: z.number().int().min(0).max(1_000_000),
  maxCombo: z.number().int().min(1).max(8),
  kills: z.number().int().min(0).max(100_000),
  durationMs: z.number().int().min(100).max(3_600_000),
  clientVersion: z.string().trim().min(1).max(32),
  attestation: RunAttestationSchema,
});
export type RunSubmitRequest = z.infer<typeof RunSubmitRequestSchema>;

export const RunSubmitResponseSchema = z.object({
  accepted: z.boolean(),
  validity: RunValiditySchema,
  /** 1-based rank on the submitted board, when the run counts. */
  rank: z.number().int().positive().nullable(),
  bestScore: z.number().int().nonnegative(),
});
export type RunSubmitResponse = z.infer<typeof RunSubmitResponseSchema>;

// --------------------------------------------------------------- leaderboard

export const LeaderboardRowSchema = z.object({
  rank: z.number().int().positive(),
  playerId: z.uuid(),
  initials: z.string(),
  score: z.number().int().nonnegative(),
  level: z.number().int().nonnegative(),
  isYou: z.boolean(),
});
export type LeaderboardRow = z.infer<typeof LeaderboardRowSchema>;

export const LeaderboardResponseSchema = z.object({
  scope: z.enum(["global", "daily"]),
  mode: RunModeSchema,
  /** Present for the daily scope (YYYY-MM-DD). */
  day: z.string().nullable(),
  rows: z.array(LeaderboardRowSchema),
});
export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>;

// --------------------------------------------------------------- legacy migration

/**
 * One entry from a returning player's local table (task 3.13). The browser
 * supplies its own `id`, which is the dedupe key: a retried upload with the
 * same ids inserts nothing, so the migration is idempotent by construction.
 */
export const LegacyScoreSchema = z.object({
  /** The entry's id in the browser's own table. */
  id: z.string().trim().min(1).max(128),
  score: z.number().int().min(0).max(1_000_000),
  level: z.number().int().min(1).max(100),
  chips: z.number().int().min(0).max(1_000_000),
  maxCombo: z.number().int().min(1).max(8),
  /** When the run was played, epoch ms on the browser's clock. */
  date: z.number().int().min(0),
  /** Absent on pre-versioning entries — the server tags those as 1. */
  scoringVersion: z.number().int().min(1).max(99).optional(),
});
export type LegacyScore = z.infer<typeof LegacyScoreSchema>;

/** The batch upload. Capped so a corrupt table cannot flood the endpoint. */
export const MigrateScoresRequestSchema = z.object({
  entries: z.array(LegacyScoreSchema).min(1).max(100),
});
export type MigrateScoresRequest = z.infer<typeof MigrateScoresRequestSchema>;

export const MigrateScoresResponseSchema = z.object({
  /** Entries this call actually stored. */
  migrated: z.number().int().nonnegative(),
  /** Entries already present from an earlier call — the idempotence proof. */
  duplicates: z.number().int().nonnegative(),
  bestScore: z.number().int().nonnegative(),
  totalRuns: z.number().int().nonnegative(),
});
export type MigrateScoresResponse = z.infer<typeof MigrateScoresResponseSchema>;

// --------------------------------------------------------------- moderation

export const NameReportRequestSchema = z.object({
  reason: z.string().trim().min(1).max(280),
});
export type NameReportRequest = z.infer<typeof NameReportRequestSchema>;

export const NameReportResponseSchema = z.object({
  reported: true,
  /** The report id, for the moderation queue. */
  reportId: z.number().int(),
});
export type NameReportResponse = z.infer<typeof NameReportResponseSchema>;

export const ModerationQueueRowSchema = z.object({
  id: z.number().int(),
  reportedPlayerId: z.uuid(),
  reportedName: z.string(),
  reason: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
});
export type ModerationQueueRow = z.infer<typeof ModerationQueueRowSchema>;

export const ModerationQueueResponseSchema = z.object({
  rows: z.array(ModerationQueueRowSchema),
});
export type ModerationQueueResponse = z.infer<typeof ModerationQueueResponseSchema>;

export const ModerationResolveRequestSchema = z.object({
  action: z.enum(["clear", "uphold"]),
});
export type ModerationResolveRequest = z.infer<typeof ModerationResolveRequestSchema>;

// --------------------------------------------------------------- errors

/** Stable machine-readable error codes the client can branch on. */
export const API_ERROR_CODES = [
  "VALIDATION_FAILED",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "NAME_REJECTED",
  "RUN_NOT_FOUND",
  "ATTESTATION_FAILED",
  "RUN_IMPLAUSIBLE",
  "RATE_LIMITED",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
