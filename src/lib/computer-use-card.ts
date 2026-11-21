/**
 * The card Zorvo shows when an agent calls `request_access`: which apps it
 * asks to use, read from this Mac by the backend, and the user's ticks.
 * Zorvo makes it, never the agent's own permission request, and the answer
 * goes to the backend as row keys, never as a bundle id or a path.
 */
import type { ActionCard, ChatMessage, ComputerUseApp, ComputerUseRequest, ComputerUseTier } from '../types';
import { escapeVisible } from './visible-text';

export const COMPUTER_USE_ALLOW = 'computer-use-allow';
export const COMPUTER_USE_DENY = 'computer-use-deny';

const CARD_PREFIX = 'computer-use-';
const TIERS: readonly ComputerUseTier[] = ['full', 'click', 'view', 'never'];
const MAX_APPS = 10;
const MAX_ICON_CHARS = 200_000;
/** The longest of each string kept from an event; the backend sends far less. */
const MAX = { name: 80, signer: 120, path: 1024, label: 40, warning: 200, reason: 600 } as const;

export const COMPUTER_USE_CARD_COPY = {
  title: (agentName: string) => `${agentName} wants to use apps on your Mac`,
  data: (agentName: string) => `What ${agentName} sees in these apps goes to its model provider.`,
  allow: 'Allow for this session',
  deny: 'Deny',
  denied: 'Denied',
  notAnswered: 'Not answered',
  noneTicked: 'Tick at least one app to allow.',
  notSetUp: 'Computer use is not set up on this Mac. Finish it in Settings, under Agents.',
} as const;

/** A `computer-use-request` event, as the backend sent it. */
export interface ComputerUseRequestEvent {
  callId: string;
  sessionId: string;
  request: ComputerUseRequest;
}

const text = (value: unknown, max = 256): string | undefined =>
  typeof value === 'string' && value !== '' ? value.slice(0, max) : undefined;
/** Text from a file on this Mac that an agent may have written: cut, then made safe to show. */
const shown = (value: unknown, max: number): string | undefined => {
  const kept = text(value, max);
  return kept === undefined ? undefined : escapeVisible(kept);
};

function parseApp(value: unknown): ComputerUseApp | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const tier = TIERS.find((known) => known === raw.tier);
  const key = text(raw.key, 32);
  const name = shown(raw.name, MAX.name);
  const label = text(raw.label, MAX.label);
  if (!tier || !key || !name || !label) return null;
  const icon = text(raw.icon, MAX_ICON_CHARS + 1);
  return {
    key,
    name,
    path: shown(raw.path, MAX.path),
    signer: shown(raw.signer, MAX.signer),
    tier,
    label,
    warning: text(raw.warning, MAX.warning),
    installed: raw.installed === true,
    icon: icon?.startsWith('data:image/png;base64,') && icon.length <= MAX_ICON_CHARS ? icon : undefined,
  };
}

/** Reads the event; anything that is not a whole request is dropped. */
export function parseComputerUseRequest(payload: unknown): ComputerUseRequestEvent | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const raw = payload as Record<string, unknown>;
  const callId = text(raw.callId);
  const sessionId = text(raw.sessionId);
  if (!callId || !sessionId || raw.kind !== 'apps' || !Array.isArray(raw.apps)) return null;
  const apps = raw.apps.slice(0, MAX_APPS).map(parseApp);
  if (apps.length === 0 || apps.some((app) => app === null)) return null;
  return {
    callId,
    sessionId,
    request: {
      kind: 'apps',
      reason: shown(raw.reason, MAX.reason) ?? '',
      apps: apps as ComputerUseApp[],
    },
  };
}

export const computerUseCardId = (callId: string): string => `${CARD_PREFIX}${callId}`;

/** A computer-use card's id: its answer is never the agent's to take. */
export const isComputerUseCardId = (cardId: string): boolean => cardId.startsWith(CARD_PREFIX);

export function computerUseCard(event: ComputerUseRequestEvent, agentName: string, now: number): ActionCard {
  return {
    id: computerUseCardId(event.callId),
    sessionId: event.sessionId,
    title: COMPUTER_USE_CARD_COPY.title(agentName),
    prompt: event.request.reason,
    status: 'pending',
    timestamp: now,
    options: [
      { optionId: COMPUTER_USE_ALLOW, name: COMPUTER_USE_CARD_COPY.allow, kind: 'allow_always' },
      { optionId: COMPUTER_USE_DENY, name: COMPUTER_USE_CARD_COPY.deny, kind: 'reject_once' },
    ],
    computerUse: event.request,
  };
}

/** Whether the user can tick this row: an app on this Mac that Zorvo lets agents use. */
export const canTick = (app: ComputerUseApp): boolean => app.installed && app.tier !== 'never';

/** The ticks as they travel with a card's answer, also from a popout: `{ [key]: "on" }`. */
export function ticksAsAnswers(keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.map((key) => [key, 'on']));
}

/** The ticked keys of an answer that belong to rows of this card the user could tick. */
export function allowedKeys(card: ActionCard, answers: Record<string, string> | undefined): string[] {
  const rows = usableComputerUse(card.computerUse)?.apps ?? [];
  return rows.filter((app) => canTick(app) && answers?.[app.key] === 'on').map((app) => app.key);
}

export type ComputerUseOutcome = { kind: 'allowed'; keys: readonly string[] } | { kind: 'denied' } | { kind: 'withdrawn' };

/** The card answered: its icons go (they are large and no longer shown), and what was allowed stays. */
export function settleComputerUseCard(messages: ChatMessage[], cardId: string, outcome: ComputerUseOutcome): ChatMessage[] {
  if (!messages.some((message) => message.actionCard?.id === cardId)) return messages;
  return messages.map((message) => {
    const card = message.actionCard;
    const request = card?.computerUse;
    if (!card || card.id !== cardId || !request) return message;
    const apps = request.apps.map(({ icon: _icon, ...app }) => app);
    const allowed =
      outcome.kind === 'allowed' ? apps.filter((app) => outcome.keys.includes(app.key)).map((app) => app.name) : [];
    const isAllowed = allowed.length > 0;
    return {
      ...message,
      actionCard: {
        ...card,
        status: isAllowed ? 'approved' : 'rejected',
        chosenOptionId: isAllowed ? COMPUTER_USE_ALLOW : outcome.kind === 'withdrawn' ? undefined : COMPUTER_USE_DENY,
        computerUse: { ...request, apps, ...(isAllowed ? { allowed } : {}) },
      },
    };
  });
}

/**
 * A transcript as loaded, without the icons of cards that no longer wait: a card left open when
 * Zorvo closed is settled by the loader, which knows nothing of its icons.
 */
export function withoutSettledIcons(messages: ChatMessage[]): ChatMessage[] {
  const hasIcons = (message: ChatMessage) =>
    message.actionCard?.status !== 'pending' &&
    Array.isArray(message.actionCard?.computerUse?.apps) &&
    message.actionCard.computerUse.apps.some((app) => app?.icon !== undefined);
  if (!messages.some(hasIcons)) return messages;
  return messages.map((message) => {
    const card = message.actionCard;
    if (!card?.computerUse || !hasIcons(message)) return message;
    const apps = card.computerUse.apps.map(({ icon: _icon, ...app }) => app);
    return { ...message, actionCard: { ...card, computerUse: { ...card.computerUse, apps } } };
  });
}

/** The mark of a card read back from a transcript, when it is whole. */
export function usableComputerUse(mark: unknown): ComputerUseRequest | undefined {
  if (typeof mark !== 'object' || mark === null) return undefined;
  const raw = mark as Record<string, unknown>;
  if (raw.kind !== 'apps' || typeof raw.reason !== 'string' || !Array.isArray(raw.apps)) return undefined;
  const isApp = (app: unknown) =>
    typeof app === 'object' &&
    app !== null &&
    typeof (app as ComputerUseApp).key === 'string' &&
    typeof (app as ComputerUseApp).name === 'string' &&
    typeof (app as ComputerUseApp).label === 'string';
  return raw.apps.every(isApp) ? (mark as ComputerUseRequest) : undefined;
}

/** What a settled card says. */
export function settledComputerUseWords(card: ActionCard): string {
  const allowed = card.computerUse?.allowed ?? [];
  if (card.status === 'approved' && allowed.length > 0) return `Allowed for this session: ${allowed.join(', ')}`;
  return card.chosenOptionId === COMPUTER_USE_DENY ? COMPUTER_USE_CARD_COPY.denied : COMPUTER_USE_CARD_COPY.notAnswered;
}

/** What each session may use, as `computer_use_state` reports it. */
export interface ComputerUseGrant {
  sessionId: string;
  apps: { name: string; tier: ComputerUseTier }[];
  fullScreen: boolean;
}

export interface ComputerUseState {
  grants: ComputerUseGrant[];
  requests: ComputerUseRequestEvent[];
}

export function parseComputerUseState(value: unknown): ComputerUseState {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const grants = (Array.isArray(raw.grants) ? raw.grants : []).flatMap((entry): ComputerUseGrant[] => {
    const grant = entry as Record<string, unknown> | null;
    const sessionId = text(grant?.sessionId);
    if (!grant || !sessionId || !Array.isArray(grant.apps)) return [];
    const apps = grant.apps.flatMap((app: unknown) => {
      const row = app as Record<string, unknown> | null;
      const name = shown(row?.name, MAX.name);
      const tier = TIERS.find((known) => known === row?.tier);
      return name && tier ? [{ name, tier }] : [];
    });
    return [{ sessionId, apps, fullScreen: grant.fullScreen === true }];
  });
  const requests = (Array.isArray(raw.requests) ? raw.requests : []).flatMap((entry) => {
    const request = parseComputerUseRequest(entry);
    return request ? [request] : [];
  });
  return { grants, requests };
}

/** The status line under a session's messages: "Using Notes, Simulator". */
export function usingLine(grant: ComputerUseGrant): string {
  if (grant.fullScreen) return 'Controlling your screen';
  return `Using ${grant.apps.map((app) => app.name).join(', ')}`;
}

export const STOP_COMPUTER_USE = 'Stop computer use';
