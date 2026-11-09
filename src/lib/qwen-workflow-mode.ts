/**
 * Qwen Code offers its Workflow mode in every session it records, but turns it on only when workflows are on in its own
 * settings (`tools.workflowsEnabled`); otherwise `session/set_config_option` fails with an internal error. The option's
 * `_meta["qwen.workflowMode"].available` says which, so Zorvo shows On as unavailable instead of sending a pick Qwen
 * refuses. Zorvo never changes Qwen's settings itself.
 */
const WORKFLOW_OPTION_ID = 'workflow_mode';
const META_KEY = 'qwen.workflowMode';
/** Qwen's reason when workflows are off in its settings. */
const NOT_ENABLED = 'workflow_unavailable';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Why the agent cannot take this choice of this option, in Zorvo's words; undefined when it can. */
export function unavailableChoiceReason(option: Record<string, unknown>, value: string): string | undefined {
  if (option.id !== WORKFLOW_OPTION_ID || value !== 'on' || !isObject(option._meta)) return undefined;
  const state = option._meta[META_KEY];
  if (!isObject(state) || state.available !== false) return undefined;
  return state.reason === NOT_ENABLED
    ? "Turn on workflows in Qwen Code's settings first."
    : 'Qwen Code cannot turn this on in this session.';
}
