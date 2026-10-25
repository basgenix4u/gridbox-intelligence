/**
 * The typed client for the Gridbox v1 API (task 4.1b).
 *
 * Design rules, in order of importance:
 *
 * 1. **Never throws.** Every call returns an `ApiResult` — a discriminated
 *    union carrying either the parsed payload or a classified error. A network
 *    blip, a 500 or a rate limit must not be able to take the game down: the
 *    player keeps playing either way. The one exception is a *programming*
 *    error (a malformed response from our own server), which surfaces as a
 *    `MALFORMED_RESPONSE` result rather than an exception.
 *
 * 2. **Errors are classified, not just reported.** `retryable` and
 *    `retryAfterMs` are decided here, once, so the retry/backoff layer (4.2)
 *    reads a decision instead of re-deriving status-code semantics at every
 *    call site.
 *
 * 3. **Zod stays out of the bundle.** Types come from `shared/contracts`;
 *    nothing here imports a schema. Responses are validated by *shape*, which
 *    is what the contract guarantees anyway — see `MALFORMED_RESPONSE`.
 *
 * 4. **Dependencies are injected.** `fetchImpl`, the token store and the base
 *    URL are all parameters, so the whole client is testable without a
 *    network, a DOM or a server.
 */

import type {
  AuthResponse,
  LeaderboardResponse,
  MigrateScoresRequest,
  MigrateScoresResponse,
  Player,
  RunMode,
  RunStartResponse,
  RunSubmitRequest,
  RunSubmitResponse,
  UpdateMeRequest,
} from "../shared/contracts.js";
import type { KeyValueStore } from "../core/ports/storage.js";
import { createLocalStorageStore } from "../core/adapters/localStorageStore.js";

/** Where the session token lives. Prefixed like every other app key. */
export const TOKEN_KEY = "gridbox-intelligence.session.token.v1";

const CLIENT_VERSION = "0.1.0";

/** Sent as `x-client-version`; lets the server gate old builds later. */
export function clientVersion(): string {
  return CLIENT_VERSION;
}

// ------------------------------------------------------------------ results

/**
 * Why a call failed. `code` is either one of ours (network-level) or the
 * server's own error code, passed through so the UI can branch on it.
 */
export interface ApiError {
  code: string;
  message: string;
  /** True when an identical retry could succeed. Drives 4.2's backoff. */
  retryable: boolean;
  /** When the server told us how long to wait (429 + `Retry-After`). */
  retryAfterMs?: number;
  /** The server's request id, when there was one — invaluable in logs. */
  requestId?: string;
  status?: number;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

export function err(error: ApiError): ApiResult<never> {
  return { ok: false, error };
}

// --------------------------------------------------------------- the client

export interface GameApiClient {
  /** Creates (or resumes) the anonymous session. No token required. */
  createSession(displayName?: string): Promise<ApiResult<AuthResponse>>;
  /** The signed-in player. */
  getMe(): Promise<ApiResult<Player>>;
  /** Renames the player — the moment a legacy migration becomes possible. */
  updateMe(body: UpdateMeRequest): Promise<ApiResult<Player>>;
  /** Asks the server to start a run: seed, nonce, start token. */
  startRun(mode: RunMode): Promise<ApiResult<RunStartResponse>>;
  /** Submits a finished run with its attestation chain. */
  submitRun(runId: string, body: Omit<RunSubmitRequest, "clientVersion">): Promise<ApiResult<RunSubmitResponse>>;
  /** Global best-per-player board. */
  globalBoard(mode: RunMode, limit?: number): Promise<ApiResult<LeaderboardResponse>>;
  /** Today's board. */
  dailyBoard(mode: RunMode, limit?: number, day?: string): Promise<ApiResult<LeaderboardResponse>>;
  /** One-shot upload of pre-server local history (3.13). */
  migrateScores(entries: MigrateScoresRequest["entries"]): Promise<ApiResult<MigrateScoresResponse>>;
  /** Whether this player has already migrated. */
  migrationStatus(): Promise<ApiResult<{ migrated: boolean }>>;
}

export interface ApiClientDeps {
  /** Origin of the API. Relative (`""`) in the browser — same-origin on Vercel. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Where the session token is kept. Defaults to localStorage. */
  tokenStore?: KeyValueStore;
  /** Injected so tests can force the offline branch deterministically. */
  isOnline?: () => boolean;
}

/** The error body every API failure returns. */
interface ApiErrorBody {
  error?: { code?: string; message?: string };
  requestId?: string;
}

/**
 * Whether an identical retry could succeed. 408 (request timeout), 429 (rate
 * limited) and every 5xx are worth another go; a 4xx means the request itself
 * was wrong, and retrying sends the same wrong request again.
 */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  return undefined;
}

/**
 * Builds the client. Cheap to call: the token store is shared and `fetch` is
 * the platform's, so a caller can construct one per component if it wants.
 */
export function createApiClient(deps: ApiClientDeps = {}): GameApiClient {
  const base = deps.baseUrl ?? "";
  const fetchImpl = deps.fetchImpl ?? fetch;
  const tokenStore = deps.tokenStore ?? createLocalStorageStore();
  const isOnline = deps.isOnline ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));

  async function request<T>(
    method: string,
    path: string,
    options: { body?: unknown; auth?: boolean } = {},
  ): Promise<ApiResult<T>> {
    // Offline first: a guaranteed failure is cheaper than a hung socket, and it
    // lets the UI say "offline" instead of "server error".
    if (!isOnline()) {
      return err({ code: "OFFLINE", message: "No connection", retryable: true });
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
      "x-client-version": CLIENT_VERSION,
    };
    if (options.auth !== false) {
      const token = tokenStore.get(TOKEN_KEY);
      if (token) headers.authorization = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (cause) {
      // A thrown fetch is a transport failure: DNS, TLS, connection reset, or
      // the browser aborting a request during navigation. Always retryable.
      return err({
        code: "NETWORK",
        message: cause instanceof Error ? cause.message : "Network request failed",
        retryable: true,
      });
    }

    const requestId = response.headers.get("x-request-id") ?? undefined;
    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
    const text = await response.text().catch(() => "");

    if (!response.ok) {
      let code = `HTTP_${response.status}`;
      let message = response.statusText || `Request failed with ${response.status}`;
      if (text) {
        try {
          const body = JSON.parse(text) as ApiErrorBody;
          if (body.error?.code) code = body.error.code;
          if (body.error?.message) message = body.error.message;
        } catch {
          // A non-JSON error body (a proxy's HTML page, say). Keep the
          // status-derived code; the statusText is still useful.
        }
      }
      return err({
        code,
        message,
        retryable: isRetryableStatus(response.status),
        retryAfterMs,
        requestId,
        status: response.status,
      });
    }

    if (!text) return err({ code: "EMPTY_BODY", message: "Server returned no body", retryable: false, requestId });

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return err({
        code: "MALFORMED_RESPONSE",
        message: "Server returned a body that is not JSON",
        retryable: false,
        requestId,
      });
    }

    return { ok: true, data: payload as T };
  }

  return {
    async createSession(displayName?: string) {
      const result = await request<AuthResponse>("POST", "/v1/auth/anonymous", {
        body: displayName === undefined ? {} : { displayName },
        auth: false,
      });
      if (result.ok) tokenStore.set(TOKEN_KEY, result.data.token);
      return result;
    },

    getMe: () => request<Player>("GET", "/v1/me"),

    updateMe: (body) => request<Player>("PATCH", "/v1/me", { body }),

    startRun: (mode) => request<RunStartResponse>("POST", "/v1/runs/start", { body: { mode } }),

    async submitRun(runId, body) {
      return request<RunSubmitResponse>("POST", `/v1/runs/${runId}/submit`, {
        body: { ...body, clientVersion: CLIENT_VERSION },
      });
    },

    globalBoard: (mode, limit = 20) =>
      request<LeaderboardResponse>("GET", `/v1/leaderboard?mode=${encodeURIComponent(mode)}&limit=${limit}`),

    dailyBoard: (mode, limit = 20, day?: string) => {
      const params = new URLSearchParams({ mode, limit: String(limit) });
      if (day) params.set("day", day);
      return request<LeaderboardResponse>("GET", `/v1/leaderboard/daily?${params.toString()}`);
    },

    migrateScores: (entries) => request<MigrateScoresResponse>("POST", "/v1/me/migrate-scores", { body: { entries } }),

    migrationStatus: () => request<{ migrated: boolean }>("GET", "/v1/me/migration-status"),
  };
}

/** Reads the stored token without touching the network. */
export function readToken(store: KeyValueStore): string | null {
  return store.get(TOKEN_KEY);
}

/** Forgets the session — used on sign-out and by tests. */
export function clearToken(store: KeyValueStore): void {
  store.remove(TOKEN_KEY);
}

/**
 * True when a failure is the kind that a retry could fix, as opposed to the
 * request itself being wrong. 4.2's backoff loop asks this before sleeping.
 */
export function isRetryable(error: ApiError): boolean {
  return error.retryable;
}
