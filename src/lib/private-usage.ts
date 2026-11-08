import { modelLabel, turnsFor, type ModelPrice } from "./private-credits";
import type { Session } from "../types";

/** The backend's answer for one private session. */
export interface PrivateSessionUsage {
  credits: number;
  estimated: boolean;
  calls: number;
}

/** A per-model row in Settings' "Used by N models" list. */
export interface PrivateUsageRow {
  modelId: string;
  profileId: string;
  credits: number;
  turnsLeft: number | null;
}

/** A valid backend answer; malformed values are ignored by the UI. */
export function parsePrivateSessionUsage(value: unknown): PrivateSessionUsage | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.credits !== "number" ||
    !Number.isFinite(candidate.credits) ||
    candidate.credits < 0 ||
    typeof candidate.estimated !== "boolean"
  ) {
    return null;
  }
  return {
    credits: candidate.credits,
    estimated: candidate.estimated,
    calls: typeof candidate.calls === "number" && Number.isFinite(candidate.calls) ? candidate.calls : 0,
  };
}

/** "3.1 credits", "34 credits"; one decimal only when it says something. */
export function formatUsageCredits(credits: number): string {
  if (!Number.isFinite(credits) || credits < 0) return "0 credits";
  const rounded = Math.round(credits * 10) / 10;
  const text = rounded.toLocaleString("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 1,
  });
  return `${text} ${rounded === 1 ? "credit" : "credits"}`;
}

/** "about 34 credits" while any part is estimated. */
export function usageLead(credits: number, estimated: boolean): string {
  return `${estimated ? "about " : ""}${formatUsageCredits(credits)}`;
}

/** A private usage total in dollars: NEAR AI bills 120 credits per dollar of cost. */
export function usageUsd(credits: number): string {
  if (!Number.isFinite(credits) || credits < 0) return "$0.00";
  return `$${(credits / 120).toFixed(2)}`;
}

/** The total used, summed per model, from the persisted session totals. */
export function privateUsageRows(
  sessions: readonly Session[],
  models: readonly ModelPrice[] | null | undefined,
  balanceCredits: number | null,
): PrivateUsageRow[] {
  const byModel = new Map<string, { profileId: string; credits: number }>();
  for (const session of sessions) {
    const modelId = session.privateMode?.modelId;
    const credits = session.privateUsage?.credits ?? 0;
    if (modelId === undefined || !Number.isFinite(credits) || credits <= 0) continue;
    const previous = byModel.get(modelId);
    byModel.set(modelId, {
      profileId: previous?.profileId ?? session.profileId,
      credits: (previous?.credits ?? 0) + credits,
    });
  }
  return [...byModel.entries()].map(([modelId, row]) => {
    const price = models?.find((model) => model.id === modelId);
    return {
      modelId,
      profileId: row.profileId,
      credits: row.credits,
      turnsLeft:
        price !== undefined && balanceCredits !== null && Number.isFinite(balanceCredits)
          ? turnsFor(balanceCredits, price)
          : null,
    };
  });
}

/** The label over a usage row: "Qwen Code · Qwen 3.8 27B". */
export function privateUsageLabel(row: PrivateUsageRow, agentNameOf: (profileId: string) => string): string {
  return `${agentNameOf(row.profileId)} · ${modelLabel(row.modelId)}`;
}