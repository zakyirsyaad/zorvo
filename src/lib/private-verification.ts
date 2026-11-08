import type {
  ChatMessage,
  MessageVerification,
  VerificationKind,
  VerificationState,
} from '../types';

/** One record as the `private_verify` command returns it. */
export interface VerificationRecord {
  startedAt: number;
  endedAt: number;
  state: VerificationState;
  kind?: VerificationKind;
  signer?: string;
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
  };
}

/** A record belongs to the reply whose turn contains its start. */
function belongsTo(message: ChatMessage, record: VerificationRecord): boolean {
  return (
    message.role === 'agent' &&
    message.hasKnownTime !== false &&
    message.completedAt !== undefined &&
    record.startedAt >= message.timestamp &&
    record.startedAt <= message.completedAt
  );
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
  return messages.map((message) => {
    const inWindow = records.filter((record) => belongsTo(message, record));
    if (inWindow.length === 0) return message;
    return { ...message, verification: summarizeVerification(inWindow) };
  });
}

export function shortSigner(signer: string): string {
  return signer.length <= 12 ? signer : `${signer.slice(0, 6)}…${signer.slice(-4)}`;
}

export function signedCallsText(verification: MessageVerification): string {
  return `${verification.signed} of ${verification.total} ${verification.total === 1 ? 'call' : 'calls'} signed`;
}

export const VERIFICATION_LABEL: Record<VerificationState, string> = {
  verified: 'Verified in TEE',
  didnt_verify: "Didn't verify",
  not_signed: 'Not signed',
  checking: 'Checking the signature',
};

export function verificationKindText(kind: VerificationKind | undefined): string {
  if (kind === 'provider_tee') return "Signed by the model's TEE";
  if (kind === 'gateway') return "Signed by NEAR AI's attested gateway";
  return "Signed by a key in NEAR AI's attestation report";
}
