import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

/**
 * Anonymous session authentication.
 *
 * Players get a long-lived HS256 session token bound to their player id. The
 * token itself is never stored — only its sha256 hash, so a database leak
 * cannot be replayed into sessions. Run-start tokens are separate, short-lived
 * proofs that the server issued a specific run.
 */
const ISSUER = "gridbox-intelligence";
const SESSION_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
const START_TOKEN_TTL_SECONDS = 2 * 60 * 60; // 2 hours — a run cannot stall forever

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function issueSessionToken(playerId: string, secret: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(playerId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey(secret));
}

export interface SessionClaims {
  playerId: string;
}

/** Returns the claims, or null when the token is missing, malformed or expired. */
export async function verifySessionToken(token: string, secret: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), { issuer: ISSUER });
    if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
    return { playerId: payload.sub };
  } catch {
    return null;
  }
}

export interface RunStartClaims {
  runId: string;
  playerId: string;
  mode: string;
  day: string;
  seed: number;
  nonce: string;
}

export async function issueRunStartToken(claims: RunStartClaims, secret: string): Promise<string> {
  return new SignJWT({ mode: claims.mode, day: claims.day, seed: claims.seed, nonce: claims.nonce })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.playerId)
    .setJti(claims.runId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${START_TOKEN_TTL_SECONDS}s`)
    .sign(secretKey(secret));
}

/** Verifies a run-start token and checks it was issued for this run and player. */
export async function verifyRunStartToken(
  token: string,
  secret: string,
  expected: { runId: string; playerId: string },
): Promise<RunStartClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), { issuer: ISSUER });
    if (payload.jti !== expected.runId) return null;
    if (payload.sub !== expected.playerId) return null;
    if (typeof payload.nonce !== "string" || typeof payload.seed !== "number") return null;
    if (typeof payload.mode !== "string" || typeof payload.day !== "string") return null;
    return {
      runId: payload.jti,
      playerId: payload.sub,
      mode: payload.mode,
      day: payload.day,
      seed: payload.seed,
      nonce: payload.nonce,
    };
  } catch {
    return null;
  }
}

/** sha256 hex of a session token — what the database is allowed to know. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Opening link of the attestation chain. Unguessable, single-use. */
export function randomNonce(): string {
  return randomBytes(16).toString("hex");
}

/** Server-issued run seed (signed 32-bit, safe for the engine's mulberry32). */
export function randomSeed(): number {
  return randomBytes(4).readUInt32BE(0) >>> 0;
}

export function newRunId(): string {
  return randomUUID();
}

/** sha256 hex helper shared by the attestation verifier. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
