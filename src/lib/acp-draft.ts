import type { AcpConfigOption, AcpModels, AcpModes, AcpOptions } from '../hooks/useAcpSessions';
import { safeModeToApply, type SafeModeChange } from './acp-modes';
import type { SlashCommand } from '../types';

/** The modes and config options an ACP agent reported, remembered per agent. */
export interface AgentOptions {
  modes: AcpModes | null;
  configOptions: AcpConfigOption[];
  /** The models the agent reports in `models`, for an agent that has no model config option. */
  models?: AcpModels | null;
  commands?: SlashCommand[];
  /** The model the user picked last, by config id, to start the next session with. */
  preferredConfig?: Readonly<Record<string, string>>;
  /** The model the user picked last among `models`, to start the next session with. */
  preferredModelId?: string;
  /**
   * Each model's effort option, as the agent reported it while that model was on: an agent reports the
   * effort list of the model it runs only (Qwen Code: Low, High and Max for one model, Thinking on for
   * another), so a draft that picks another model shows that model's list.
   */
  effortsByModel?: Readonly<Record<string, AcpConfigOption>>;
}

/** What the user picked in the composer before the agent runs: a mode, a model and config values by id. */
export interface AcpChoices {
  modeId?: string;
  /** A model among the agent's `models`; only for an agent without a model config option (`hasModelConfig`). */
  modelId?: string;
  config: Readonly<Record<string, string>>;
}

export const NO_CHOICES: AcpChoices = { config: {} };

export type AcpChange = SafeModeChange | { kind: 'model'; modelId: string };

/**
 * The settings a pick of is kept for the next session: the model, the reasoning effort and the model's
 * own switches (Claude's fast mode). Collaboration mode and the agent persona are about one task, so a
 * new session starts on the agent's default for them, as it does for the permission mode.
 */
const REMEMBERED_CATEGORIES = new Set(['model', 'thought_level', 'model_config']);

const isKept = (option: AcpConfigOption | undefined) =>
  option?.category !== undefined && REMEMBERED_CATEGORIES.has(option.category);

/**
 * Whether the agent's model is a config option, which is then the composer's model chip (`acpControls`)
 * and carries the picks. Codex and Qwen Code report `models` as well; a `models` pick only counts for
 * an agent without one.
 */
export function hasModelConfig(configOptions: readonly AcpConfigOption[]): boolean {
  return configOptions.some((o) => o.category === 'model' && o.options.length > 0);
}

type ReportedLists = Pick<AgentOptions, 'configOptions' | 'models'>;

const isEffort = (option: AcpConfigOption) => option.category === 'thought_level';

const modelConfigOf = (configOptions: readonly AcpConfigOption[]) => configOptions.find((o) => o.category === 'model');

/** The model the agent ran when it reported these lists: its model option's value, else its `models` pick. */
function reportedModelOf(lists: ReportedLists): string | undefined {
  return modelConfigOf(lists.configOptions)?.currentValue ?? lists.models?.currentModelId;
}

/** `known` with the effort list in `reported` kept under the model it was reported for. */
export function withEffortList(known: AgentOptions, reported: ReportedLists = known): AgentOptions {
  const model = reportedModelOf(reported);
  const effort = reported.configOptions.find(isEffort);
  if (!model || !effort) return known;
  return { ...known, effortsByModel: { ...known.effortsByModel, [model]: effort } };
}

/** The remembered options after an update from a session, a pick or a probe, with its effort list kept under its model. */
export function withReported(known: AgentOptions | undefined, update: Partial<AgentOptions>): AgentOptions {
  return withEffortList({ modes: null, configOptions: [], ...known, ...update });
}

/** The model a draft will start on: picked for this session, else the agent's reported one. */
function draftModelOf(options: AgentOptions, choices: AcpChoices): string | undefined {
  const modelConfig = modelConfigOf(options.configOptions);
  return (modelConfig && choices.config[modelConfig.id]) ?? choices.modelId ?? reportedModelOf(options);
}

/**
 * The agent's reported lists for a draft on `model`: on another model than the agent reported, the effort
 * list is that model's, or none while it is unknown, never the reported model's.
 */
function listsForModel(options: AgentOptions, model: string | undefined): AcpConfigOption[] {
  if (model === undefined || model === reportedModelOf(options)) return options.configOptions;
  const effort = options.effortsByModel?.[model];
  return options.configOptions.flatMap((o) => (isEffort(o) ? (effort ? [effort] : []) : [o]));
}

/** The model and effort a session runs with now, by config id. */
export function keptConfigOf(configOptions: readonly AcpConfigOption[]): Record<string, string> {
  return Object.fromEntries(configOptions.filter(isKept).map((o): [string, string] => [o.id, o.currentValue]));
}

/**
 * The user's picks plus the model and effort they picked last, while the
 * agent still offers them: agents such as Qwen Code change these for one
 * session only, so without this every new session would start on its defaults.
 */
export function withPreferred(choices: AcpChoices, options: AgentOptions | undefined): AcpChoices {
  if (!options) return choices;
  const isOffered = (lists: readonly AcpConfigOption[], configId: string, value: string) =>
    lists.find((o) => o.id === configId)?.options.some((c) => c.value === value) ?? false;
  const preferredModel = options.preferredModelId;
  const modelId =
    choices.modelId === undefined && preferredModel && options.models?.availableModels.some((m) => m.modelId === preferredModel)
      ? preferredModel
      : undefined;
  // The model goes first: whether an effort is offered depends on the model the session starts on.
  const modelConfig = modelConfigOf(options.configOptions);
  const preferredModelPick = modelConfig && options.preferredConfig?.[modelConfig.id];
  const startModel =
    (modelConfig && choices.config[modelConfig.id]) ??
    (preferredModelPick && isOffered(options.configOptions, modelConfig.id, preferredModelPick) ? preferredModelPick : undefined) ??
    choices.modelId ??
    modelId;
  const lists = listsForModel(options, startModel);
  // An effort for a model whose list is not known yet stays: the agent's own list is checked once the model is set.
  const isUnknownEffort = (configId: string) =>
    options.configOptions.some((o) => o.id === configId && isEffort(o)) && !lists.some((o) => o.id === configId);
  const preferred = Object.entries(options.preferredConfig ?? {}).filter(
    ([configId, value]) => isOffered(lists, configId, value) || isUnknownEffort(configId),
  );
  if (preferred.length === 0 && modelId === undefined) return choices;
  return {
    ...choices,
    ...(modelId !== undefined ? { modelId } : {}),
    config: { ...Object.fromEntries(preferred), ...choices.config },
  };
}

/**
 * The remembered picks after the user picked `value` for `configId`, or null
 * when that setting is not kept. With what the agent reported after the
 * change, its settled values are kept instead: a model change can reset the
 * effort, and the next session should start as this one ended.
 */
export function rememberedChoice(
  options: AgentOptions | undefined,
  configId: string,
  value: string,
  reported: readonly AcpConfigOption[] = [],
): Record<string, string> | null {
  const known = reported.length > 0 ? reported : (options?.configOptions ?? []);
  if (!isKept(known.find((o) => o.id === configId))) return null;
  if (reported.length === 0) return { ...options?.preferredConfig, [configId]: value };
  return { ...options?.preferredConfig, ...keptConfigOf(reported) };
}

/**
 * What the composer shows before the agent runs: the options it reported
 * last time, with the user's picks, and the safe mode the session will be
 * switched to when the user picked none.
 */
export function draftInfo(options: AgentOptions, choices: AcpChoices): AcpOptions & { models: AcpModels | null } {
  const safe = safeModeToApply(options);
  const modes = options.modes && {
    ...options.modes,
    currentModeId: choices.modeId ?? (safe?.kind === 'mode' ? safe.modeId : options.modes.currentModeId),
  };
  const configOptions = listsForModel(options, draftModelOf(options, choices)).map((option) => {
    const safeValue = safe?.kind === 'config' && safe.configId === option.id ? safe.value : undefined;
    // A pick made on another model's list (an effort that model offered) is not shown on this one.
    const picked = choices.config[option.id];
    const pick = option.options.some((c) => c.value === picked) ? picked : undefined;
    return { ...option, currentValue: pick ?? safeValue ?? option.currentValue };
  });
  const models = options.models
    ? { ...options.models, currentModelId: choices.modelId ?? options.models.currentModelId }
    : null;
  return { modes, models, configOptions };
}

/**
 * Changes to send once the agent is up: the user's picks, or the safe mode
 * when the user picked no mode. Picks the agent no longer offers and values
 * that already hold are skipped.
 */
export function changesToApply(
  info: AcpOptions,
  choices: AcpChoices,
  applySafeMode: boolean,
): AcpChange[] {
  const changes: AcpChange[] = [];
  const pickedModel = choices.modelId;
  if (pickedModel && !hasModelConfig(info.configOptions)) {
    if (info.models) {
      const offered = info.models.availableModels.some((m) => m.modelId === pickedModel);
      if (offered && pickedModel !== info.models.currentModelId) changes.push({ kind: 'model', modelId: pickedModel });
    } else if (info.reopenedWith) {
      // A resume answer carries no models, so the pick goes out as it is and the agent refuses a model it does not know.
      changes.push({ kind: 'model', modelId: pickedModel });
    }
  }
  const pickedMode = choices.modeId;
  if (pickedMode && info.modes) {
    const offered = info.modes.availableModes.some((m) => m.id === pickedMode);
    if (offered && pickedMode !== info.modes.currentModeId) changes.push({ kind: 'mode', modeId: pickedMode });
  }
  // The model goes first: other choices, such as the effort, depend on it.
  const isModel = (configId: string) => info.configOptions.find((o) => o.id === configId)?.category === 'model';
  const picks = Object.entries(choices.config).sort(([a], [b]) => Number(isModel(b)) - Number(isModel(a)));
  for (const [configId, value] of picks) {
    const option = info.configOptions.find((o) => o.id === configId);
    const offered = option?.options.some((o) => o.value === value);
    if (option && offered && option.currentValue !== value) changes.push({ kind: 'config', configId, value });
  }
  const pickedAModeConfig = info.configOptions.some((o) => o.category === 'mode' && o.id in choices.config);
  if (applySafeMode && !pickedMode && !pickedAModeConfig) {
    const safe = safeModeToApply(info);
    if (safe) changes.push(safe);
  }
  return changes;
}

/** A rewound session's model and effort, and the lists they came from (an effort list follows its model). */
export type RewoundOptions = Required<Pick<AgentOptions, 'configOptions' | 'preferredConfig'>> &
  Pick<AgentOptions, 'preferredModelId'>;

/**
 * The remembered options, with a rewound session's own picks and lists in
 * place of its agent's: its fresh agent starts as the session ran, and an
 * effort only its model offers is not dropped.
 */
export function withRewound(
  options: Readonly<Record<string, AgentOptions>> | undefined,
  agentId: string | undefined,
  rewound: RewoundOptions | undefined,
): Readonly<Record<string, AgentOptions>> | undefined {
  if (!agentId || !rewound) return options;
  return { ...options, [agentId]: { modes: null, ...options?.[agentId], ...rewound } };
}

/** Whether an agent ever reported what it offers, so a probe need not open a session to learn it. */
export function hasReportedOptions(options: AgentOptions | undefined): boolean {
  return Boolean(options && (options.modes || options.models || options.configOptions.length > 0 || options.commands?.length));
}

/** What a probe learned about an agent: its modes, config options and slash commands. */
export type ProbedOptions = Required<Pick<AgentOptions, 'modes' | 'configOptions' | 'commands'>> &
  Pick<AgentOptions, 'models'>;

/**
 * The remembered options with what a probe learned filled in where nothing
 * is known yet. A session's report wins: it can land while the probe still
 * runs and carries the settled model and effort, which a probe's defaults
 * must not undo.
 */
export function withProbed(known: AgentOptions | undefined, probed: ProbedOptions): AgentOptions {
  if (!known) return probed;
  return {
    ...known,
    modes: known.modes ?? probed.modes,
    models: known.models ?? probed.models,
    configOptions: known.configOptions.length > 0 ? known.configOptions : probed.configOptions,
    commands: known.commands?.length ? known.commands : probed.commands,
  };
}
