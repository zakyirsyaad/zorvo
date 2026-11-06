import type { AcpOptions } from '../hooks/useAcpSessions';
import type { DropdownOption } from '../components/composer/OptionDropdown';
import { isAgentRunnable } from './agent-readiness';
import { pickerLabelOf } from './install-plan';
import type { SignInState } from './agent-sign-in';
import type { AgentProfile } from '../types';

/** One composer dropdown: the choices, the current one, and what picking does. */
export interface ComposerControl {
  options: DropdownOption[];
  selected: string | undefined;
  onChange: (value: string | undefined) => void;
}

/** A config option beyond mode, model and effort that the agent offers (Claude's fast mode, Codex's collaboration mode). */
export interface ExtraControl extends ComposerControl {
  /** The agent's config option id; also the dropdown's key. */
  id: string;
  /** The option's name, e.g. "Fast mode". */
  label: string;
  /** What the option does, when the agent says so. */
  description?: string;
}

export interface ComposerControls {
  permission?: ComposerControl;
  model?: ComposerControl;
  effort?: ComposerControl;
  extras?: ExtraControl[];
}

/** Modes that let the agent act without asking (shown with a warning icon). */
const RISKY_MODE = /yolo|bypass|dontask|full.?access|danger/i;

/** Whether a mode lets the agent act without asking; agents name theirs in the id, the label or both. */
export function isRiskyMode(modeId: string | undefined, name?: string): boolean {
  return (modeId !== undefined && RISKY_MODE.test(modeId)) || (name !== undefined && RISKY_MODE.test(name));
}

/** Config categories the composer already shows as the mode, model and effort controls. */
const NAMED_CATEGORIES = new Set(['mode', 'model', 'thought_level']);

/** A description that reads as a model's name: "Opus", "Sonnet 5.5". Anything wordier stays a description. */
const MODEL_NAME_DESCRIPTION = /^[A-Za-z0-9][A-Za-z0-9.-]*(?: [A-Za-z0-9][A-Za-z0-9.-]*)?$/;

/**
 * A model called "Default" says nothing about what it is; some agents put the
 * model in its description (Claude: "Default (recommended)", described "Opus").
 * Shown as "Default (Opus)", and the description is not repeated.
 */
function modelOption(value: string, name: string, description: string | undefined): DropdownOption {
  const named = description?.trim();
  if (named && /^default\b/i.test(name) && MODEL_NAME_DESCRIPTION.test(named)) {
    return { value, label: `${name.replace(/\s*\(.*\)\s*$/, '')} (${named})` };
  }
  return { value, label: name, description: named || undefined };
}

/** A mode (or a choice of any option) with its description, marked when it lets the agent act without asking. */
function modeOption(value: string, name: string, description: string | undefined): DropdownOption {
  return { value, label: name, description, ...(isRiskyMode(value, name) ? { risky: true } : {}) };
}

/** One choice of a config option, in the form its category calls for. */
function choiceOption(category: string | undefined, choice: { value: string; name: string; description?: string }): DropdownOption {
  if (category === 'model') return modelOption(choice.value, choice.name, choice.description);
  if (category === 'mode') return modeOption(choice.value, choice.name, choice.description);
  return { value: choice.value, label: choice.name, description: choice.description };
}

/** `undefined` when there is nothing real to choose from. */
function controlIf(options: DropdownOption[], minimum: number, rest: Omit<ComposerControl, 'options'>) {
  return options.length >= minimum ? { options, ...rest } : undefined;
}

export interface AcpControlActions {
  setMode: (modeId: string) => void;
  setModel: (modelId: string) => void;
  setConfigOption: (configId: string, value: string) => void;
}

/** Controls for an ACP session: exactly what its agent reported, applied live. */
export function acpControls(
  info: AcpOptions,
  actions: AcpControlActions,
): ComposerControls {
  const byCategory = (category: string) => info.configOptions.find((o) => o.category === category);
  const fromConfig = (category: string): ComposerControl | undefined => {
    const option = byCategory(category);
    if (!option) return undefined;
    return controlIf(
      option.options.map((c) => choiceOption(category, c)),
      1,
      { selected: option.currentValue, onChange: (value) => value && actions.setConfigOption(option.id, value) },
    );
  };

  const permission = info.modes
    ? controlIf(
        info.modes.availableModes.map((m) => modeOption(m.id, m.name, m.description)),
        1,
        { selected: info.modes.currentModeId, onChange: (value) => value && actions.setMode(value) },
      )
    : fromConfig('mode');

  // A model config option is the agent's newer way to offer models; `models` is the older one.
  const fromModels = (): ComposerControl | undefined =>
    info.models
      ? controlIf(
          info.models.availableModels.map((m) => modelOption(m.modelId, m.name, m.description)),
          1,
          { selected: info.models.currentModelId, onChange: (value) => value && actions.setModel(value) },
        )
      : undefined;

  // Every other select option the agent offers; mode, model and effort already have their own control.
  const extras = info.configOptions.flatMap((option): ExtraControl[] => {
    if (option.category !== undefined && NAMED_CATEGORIES.has(option.category)) return [];
    const control = controlIf(
      option.options.map((c) => choiceOption(option.category, c)),
      2,
      { selected: option.currentValue, onChange: (value) => value && actions.setConfigOption(option.id, value) },
    );
    return control ? [{ ...control, id: option.id, label: option.name, description: option.description }] : [];
  });

  return {
    permission,
    model: fromConfig('model') ?? fromModels(),
    effort: fromConfig('thought_level'),
    ...(extras.length > 0 ? { extras } : {}),
  };
}

/** One agent in the composer's multi-choice picker; a `disabledReason` means it cannot be ticked, and says why. */
export interface AgentChoice {
  value: string;
  /** The picker's words for the agent: its name, with "(not installed)" while it cannot start. */
  label: string;
  /** The agent's plain name, for sentences about it. */
  name: string;
  /** Whether it was seen signed in, for the picker's readiness word ("Ready", "Not checked"). */
  signIn?: SignInState;
  disabledReason?: string;
  /** What keeps it out of a compare run, for the status word on its row ("Not installed", "Needs sign-in"). */
  blockedBy?: 'install' | 'sign-in';
}

export const NOT_INSTALLED_REASON = 'You need to install it first.';
export const NEEDS_SIGN_IN_REASON = 'You need to sign in first.';

/**
 * The picker's rows. An agent that cannot start now (not installed) or said it
 * needs a sign-in cannot join a compare; one never asked ("Not checked") can.
 */
export function compareAgentOptions(
  agents: readonly Pick<AgentProfile, 'id' | 'name' | 'availability'>[],
  signInStateOf: (profileId: string) => SignInState,
): AgentChoice[] {
  return agents.map((agent) => {
    const signIn = signInStateOf(agent.id);
    const blockedBy = !isAgentRunnable(agent) ? 'install' : signIn === 'needed' ? 'sign-in' : undefined;
    const disabledReason = blockedBy === 'install' ? NOT_INSTALLED_REASON : blockedBy === 'sign-in' ? NEEDS_SIGN_IN_REASON : undefined;
    return {
      value: agent.id,
      label: pickerLabelOf(agent),
      name: agent.name,
      signIn,
      ...(blockedBy ? { blockedBy, disabledReason } : {}),
    };
  });
}
