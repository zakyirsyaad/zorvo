/**
 * What a delegated session starts on: the summary under A's prompt and the
 * choices B's first turn applies. Pure, so the composer's summary and the
 * dialog's chips read an agent's options the same way.
 */
import { NO_CHOICES, draftInfo, withPreferred, type AcpChoices, type AgentOptions } from './acp-draft';

export interface DelegatedStart {
  modelName?: string;
  effortName?: string;
  modeName?: string;
}

/**
 * The model, effort and mode a delegation starts on, as the agent last reported
 * them: its remembered model (else the current one), that model's effort, and
 * its default mode. A part Zorvo does not know is left out.
 */
export function delegatedStartOf(options: AgentOptions | undefined): DelegatedStart {
  if (options === undefined) return {};
  // The same choices a draft starts with: the remembered picks over what the agent reported.
  const info = draftInfo(options, withPreferred(NO_CHOICES, options));
  const modelConfig = info.configOptions.find((option) => option.category === 'model');
  const modelName =
    modelConfig?.options.find((choice) => choice.value === modelConfig.currentValue)?.name ??
    info.models?.availableModels.find((model) => model.modelId === info.models?.currentModelId)?.name;
  const effort = info.configOptions.find((option) => option.category === 'thought_level');
  const effortName = effort?.options.find((choice) => choice.value === effort.currentValue)?.name;
  const modeConfig = info.configOptions.find((option) => option.category === 'mode');
  const modeName =
    info.modes?.availableModes.find((mode) => mode.id === info.modes?.currentModeId)?.name ??
    modeConfig?.options.find((choice) => choice.value === modeConfig.currentValue)?.name;
  return {
    ...(modelName !== undefined ? { modelName } : {}),
    ...(effortName !== undefined ? { effortName } : {}),
    ...(modeName !== undefined ? { modeName } : {}),
  };
}

/** What a delegation to an agent starts with: the picks, over its remembered model and effort. */
export function delegationChoicesFor(options: AgentOptions | undefined, picks: AcpChoices = NO_CHOICES): AcpChoices {
  return withPreferred(picks, options);
}

/** Two sets of picks as one; the later wins, config values merged by id. */
export function mergeChoices(earlier: AcpChoices, later: AcpChoices): AcpChoices {
  return { ...earlier, ...later, config: { ...earlier.config, ...later.config } };
}
