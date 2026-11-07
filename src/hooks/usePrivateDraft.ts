import { useCallback, useEffect, useRef, useState } from 'react';
import { PRIVATE_DRAFT_TEXT, privateDraftState, type PrivateDraftState } from '../lib/private-draft';
import { formatCredits, type ModelPrice } from '../lib/private-credits';
import type { PrivateCredits } from './usePrivateCredits';

export interface PrivateDraftDeps {
  credits: Pick<PrivateCredits, 'status' | 'models' | 'loadCatalog' | 'refresh'> & { statusFailed?: boolean };
  /** The agents the new-session draft would start; empty while no draft is shown. */
  agentIds: readonly string[];
}

export interface PrivateChipControl {
  kind: 'off' | 'on' | 'disabled';
  /** Why a disabled chip is disabled. */
  reason?: string;
  onToggle: () => void;
  /** Loads the private models again; only while the chip is on and they failed to load. */
  onRetry?: () => void;
}

export interface PrivateModelChoice {
  models: readonly ModelPrice[];
  selected: string;
  onSelect: (modelId: string) => void;
}

export interface PrivateDraft {
  state: PrivateDraftState;
  /** The chip is on: the draft starts a private session. */
  isOn: boolean;
  /** What the session the draft starts now records, while on and a model is known. */
  privateMode: { modelId: string } | undefined;
  /** On, and still waiting for credits or the models: Send waits too. */
  blocksSend: boolean;
  /** What an on chip waits for, for the composer's note. */
  note?: string;
  /** "N credits left", while on and ready to start. */
  creditsLine?: string;
  /** Undefined while the chip is hidden. */
  chip?: PrivateChipControl;
  /** The private models, in place of the agent's model chip, while on. */
  modelMenu?: PrivateModelChoice;
}

function creditsOf(status: PrivateDraftDeps['credits']['status']): number {
  return status?.balance?.credits ?? status?.lastBalance?.credits ?? 0;
}

/**
 * The new-session draft's Private chip: off by default and per draft (never saved), it makes the next
 * session a Zorvo Private one on the model picked in its menu. Turning it on is the one place outside
 * Settings that loads the private catalog; nothing is asked while it stays off.
 */
export function usePrivateDraft({ credits, agentIds }: PrivateDraftDeps): PrivateDraft {
  const [isTurnedOn, setIsTurnedOn] = useState(false);
  const [pickedModelId, setPickedModelId] = useState<string | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const isAlive = useRef(true);
  useEffect(() => {
    isAlive.current = true;
    return () => {
      isAlive.current = false;
    };
  }, []);

  // A draft that goes away (it started, or another session is shown) takes its choice along: the next starts off.
  if (agentIds.length === 0 && (isTurnedOn || pickedModelId !== null)) {
    setIsTurnedOn(false);
    setPickedModelId(null);
  }

  const { status, statusFailed, models, loadCatalog, refresh } = credits;
  const state = privateDraftState({ agentIds, on: isTurnedOn, status, statusFailed, models, isLoadingModels });
  const isOn = state.chip === 'on';

  // A disabled chip (another agent, or a compare run) drops the choice too: going back to Qwen Code starts off.
  if (state.chip === 'disabled' && (isTurnedOn || pickedModelId !== null)) {
    setIsTurnedOn(false);
    setPickedModelId(null);
  }

  // Only while the chip is on (turning it on, or its Retry): the catalog is never asked for otherwise.
  const loadModels = useCallback(() => {
    setIsLoadingModels(true);
    void loadCatalog().finally(() => {
      if (isAlive.current) setIsLoadingModels(false);
    });
  }, [loadCatalog]);

  const turnOn = useCallback(() => {
    setIsTurnedOn(true);
    void refresh(true);
    loadModels();
  }, [loadModels, refresh]);

  const onToggle = () => {
    if (state.chip === 'off') turnOn();
    else if (state.chip === 'on') setIsTurnedOn(false);
  };

  const offered = models ?? [];
  const modelId = offered.find((model) => model.id === pickedModelId)?.id ?? offered[0]?.id;

  return {
    state,
    isOn,
    privateMode: isOn && modelId !== undefined ? { modelId } : undefined,
    blocksSend: isOn && !state.canStart,
    note: isOn ? state.note : undefined,
    creditsLine: isOn && state.canStart ? `${formatCredits(creditsOf(status))} left` : undefined,
    chip:
      state.chip === 'hidden'
        ? undefined
        : {
            kind: state.chip,
            reason: state.reason,
            onToggle,
            onRetry: isOn && state.note === PRIVATE_DRAFT_TEXT.modelsFailed ? loadModels : undefined,
          },
    modelMenu:
      isOn && modelId !== undefined ? { models: offered, selected: modelId, onSelect: setPickedModelId } : undefined,
  };
}
