import { acpControls, type ComposerControl } from './composer-controls';
import { NO_CHOICES, draftInfo, hasReportedOptions, withPreferred, type AgentOptions } from './acp-draft';

/**
 * Whether a compare agent's model list is known, not known yet, being asked for, could not be asked for, or known
 * to hold no model at all (the agent reported its options without one).
 */
export type CompareModelState = 'known' | 'unknown' | 'asking' | 'failed' | 'none';

/** One agent's model chip in a compare draft. */
export interface CompareModelControl {
  profileId: string;
  name: string;
  state: CompareModelState;
  /** Present only when the agent's list is known. */
  control?: ComposerControl;
}

/**
 * One model control per agent of a compare run, in the run's order. A pick is the agent's remembered model, the
 * same one a single-agent draft keeps, so the run starts each session on it through `withPreferred`.
 */
export function compareModelControls(
  agents: readonly { id: string; name: string }[],
  agentOptions: Readonly<Record<string, AgentOptions>> | undefined,
  askStateOf: (profileId: string) => 'asking' | 'failed' | undefined,
  actions: {
    pickModel: (profileId: string, modelId: string) => void;
    pickConfig: (profileId: string, configId: string, value: string) => void;
  },
): CompareModelControl[] {
  return agents.map(({ id, name }) => {
    const options = agentOptions?.[id];
    const control =
      options && hasReportedOptions(options)
        ? acpControls(draftInfo(options, withPreferred(NO_CHOICES, options)), {
            // Mode stays the safest one in a run: no mode is picked here.
            setMode: () => {},
            setModel: (modelId) => actions.pickModel(id, modelId),
            setConfigOption: (configId, value) => actions.pickConfig(id, configId, value),
          }).model
        : undefined;
    if (control) return { profileId: id, name, state: 'known', control };
    // It answered, without a model: there is nothing to ask for, and nothing to choose.
    if (options && hasReportedOptions(options)) return { profileId: id, name, state: 'none' };
    return { profileId: id, name, state: askStateOf(id) ?? 'unknown' };
  });
}
