import type {
  ChatMessage,
  MessageVerification,
  VerificationKind,
  VerificationState,
} from '../types';
import { CREDITS_PER_USD_COST, isPricedModel, type ModelPrice } from './private-credits';

/** One record as the `private_verify` command returns it. */
export interface VerificationRecord {
  startedAt: number;
  endedAt: number;
  state: VerificationState;
  kind?: VerificationKind;
  signer?: string;
  promptTokens?: number;
  completionTokens?: number;
}

/** The state a reply's records fold into: a failure beats pending, which beats a missing signature. */
export function foldedState(records: readonly VerificationRecord[]): VerificationState {
  if (records.some((record) => record.state === 'didnt_verify')) return 'didnt_verify';
  if (records.some((record) => record.state === 'checking')) return 'checking';
  if (records.length > 0 && records.every((record) => record.state === 'verified')) return 'verified';
  return 'not_signed';
}

function foldedKind(records: readonly VerificationRecord[]): VerificationKind | undefined {
  const verified = records.filter((record) => record.state === 'verified');
  if (verified.length === 0) return undefined;
  const first = verified[0]?.kind ?? 'unknown';
  return verified.every((record) => (record.kind ?? 'unknown') === first) ? first : 'unknown';
}

function foldedSigner(records: readonly VerificationRecord[]): string | undefined {
  const signers = records
    .filter((record) => record.state === 'verified')
    .map((record) => record.signer)
    .filter((signer): signer is string => Boolean(signer));
  if (signers.length === 0) return undefined;
  const first = signers[0];
  return signers.every((signer) => signer.toLowerCase() === first.toLowerCase()) ? first : undefined;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** The token counts of the calls that reported both, summed; undefined when none did. */
function foldedTokens(records: readonly VerificationRecord[]): { promptTokens: number; completionTokens: number } | undefined {
  const counted = records.filter((record) => isCount(record.promptTokens) && isCount(record.completionTokens));
  if (counted.length === 0) return undefined;
  return {
    promptTokens: counted.reduce((sum, record) => sum + (record.promptTokens ?? 0), 0),
    completionTokens: counted.reduce((sum, record) => sum + (record.completionTokens ?? 0), 0),
  };
}

export function summarizeVerification(records: readonly VerificationRecord[]): MessageVerification {
  const state = foldedState(records);
  const signed = records.filter((record) => record.state === 'verified').length;
  const kind = foldedKind(records);
  const signer = foldedSigner(records);
  return {
    state,
    ...(kind === undefined ? {} : { kind }),
    ...(signer === undefined ? {} : { signer }),
    signed,
    total: records.length,
    ...(foldedTokens(records) ?? {}),
  };
}

/**
 * A record belongs to the reply whose turn contains its start. The turn starts at `turnStart`, the
 * user's message, not at the reply: a reply's own time is its first chunk, which arrives after the
 * model call that produced it began (seen live: a one-call turn never got its badge).
 */
function belongsTo(message: ChatMessage, turnStart: number, record: VerificationRecord): boolean {
  return (
    message.role === 'agent' &&
    message.hasKnownTime !== false &&
    message.completedAt !== undefined &&
    record.startedAt >= turnStart &&
    record.startedAt <= message.completedAt
  );
}

/** When each message's turn began: the nearest user message before it, else its own time. */
function turnStarts(messages: readonly ChatMessage[]): number[] {
  let start: number | undefined;
  return messages.map((message) => {
    if (message.role === 'user' && message.hasKnownTime !== false) start = message.timestamp;
    return Math.min(start ?? message.timestamp, message.timestamp);
  });
}

/**
 * Folds records into the agent replies their times fall in. A reply the records do not reach keeps
 * what it had; a report with no records at all leaves every message alone.
 */
export function foldVerifications(
  messages: ChatMessage[],
  records: readonly VerificationRecord[],
): ChatMessage[] {
  if (records.length === 0) return messages;
  const starts = turnStarts(messages);
  return messages.map((message, index) => {
    const inWindow = records.filter((record) => belongsTo(message, starts[index] ?? message.timestamp, record));
    if (inWindow.length === 0) return message;
    return { ...message, verification: summarizeVerification(inWindow) };
  });
}

export interface ReplyUsage {
  promptTokens: number;
  completionTokens: number;
  /** Credits for the input and for the output at the model's price; absent when the price is unknown. */
  inputCredits?: number;
  outputCredits?: number;
}

/**
 * What one reply used. The credits are an estimate from the token counts and the model's listed
 * price, at the rate the balance burns (`CREDITS_PER_USD_COST`); NEAR AI's final cost can differ.
 */
export function replyUsage(verification: MessageVerification, model?: ModelPrice | null): ReplyUsage | undefined {
  const { promptTokens, completionTokens } = verification;
  if (!isCount(promptTokens) || !isCount(completionTokens)) return undefined;
  if (!model || !isPricedModel(model)) return { promptTokens, completionTokens };
  return {
    promptTokens,
    completionTokens,
    inputCredits: (promptTokens * model.inputPerM * CREDITS_PER_USD_COST) / 1e6,
    outputCredits: (completionTokens * model.outputPerM * CREDITS_PER_USD_COST) / 1e6,
  };
}

function creditsWords(credits: number): string {
  if (credits === 0) return '0 credits';
  return credits < 0.01 ? 'under 0.01 credits' : `${credits.toFixed(2)} credits`;
}

/** "Input 1,204 tokens · 0.07 credits", or the tokens alone when the price is unknown. */
export function usageLine(label: 'Input' | 'Output', tokens: number, credits?: number): string {
  const count = `${tokens.toLocaleString('en-US')} tokens`;
  return credits === undefined ? `${label} ${count}` : `${label} ${count} · ${creditsWords(credits)}`;
}

export function shortSigner(signer: string): string {
  return signer.length <= 12 ? signer : `${signer.slice(0, 6)}…${signer.slice(-4)}`;
}

export const VERIFICATION_LABEL: Record<VerificationState, string> = {
  verified: 'Verified in TEE',
  didnt_verify: "Didn't verify",
  not_signed: 'Not signed',
  checking: 'Checking the signature',
};
