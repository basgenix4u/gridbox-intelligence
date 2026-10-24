import type { PlayerRecord, Repositories } from "../ports/repositories.js";
import type { ModerationQueueResponse, NameReportResponse } from "../../src/shared/contracts.js";
import { fail } from "../errors.js";

/**
 * Moderation service (task 3.9).
 *
 * Players report display names; reports land in the queue and hold the
 * reported name out of every board until a human clears them. The queue is
 * cleared by the owner through a token-protected admin endpoint — never by
 * players. "Clear" restores the name; "uphold" resets it to the default.
 */

export interface ModerationServiceDeps {
  repos: Repositories;
}

export async function reportName(
  deps: ModerationServiceDeps,
  reporter: PlayerRecord,
  reportedPlayerId: string,
  reason: string,
): Promise<NameReportResponse> {
  if (reportedPlayerId === reporter.id) {
    throw fail("VALIDATION_FAILED", "You cannot report your own name", 400);
  }
  const reported = await deps.repos.players.findById(reportedPlayerId);
  if (!reported) {
    throw fail("NOT_FOUND", "No such player", 404);
  }
  const record = await deps.repos.reports.create({
    reporterPlayerId: reporter.id,
    reportedPlayerId,
    reportedName: reported.displayName,
    reason,
  });
  await deps.repos.audit.log({
    actor: reporter.id,
    action: "name.reported",
    meta: { reportId: record.id, reportedPlayerId, reportedName: reported.displayName },
  });
  return { reported: true, reportId: record.id };
}

export async function listQueue(deps: ModerationServiceDeps, limit = 100): Promise<ModerationQueueResponse> {
  const rows = await deps.repos.reports.listPending(Math.min(Math.max(1, limit), 500));
  return {
    rows: rows.map((r) => ({
      id: r.id,
      reportedPlayerId: r.reportedPlayerId,
      reportedName: r.reportedName,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export async function resolveReport(
  deps: ModerationServiceDeps,
  reportId: number,
  action: "clear" | "uphold",
  actor: string,
): Promise<{ resolved: true; action: "clear" | "uphold" }> {
  const record = await deps.repos.reports.resolve(reportId, action === "clear" ? "cleared" : "upheld", actor);
  if (!record) {
    throw fail("NOT_FOUND", "No such report", 404);
  }
  if (action === "uphold") {
    // The name stands condemned: reset it so it stops circulating.
    await deps.repos.players.updateName(record.reportedPlayerId, { displayName: "YOU", initials: "YOU" });
  }
  return { resolved: true, action };
}
