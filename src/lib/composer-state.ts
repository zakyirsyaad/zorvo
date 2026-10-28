import { acpControls, type ComposerControls } from './composer-controls';
import { draftInfo, type AcpChoices, type AgentOptions } from './acp-draft';
import type { AcpConfigOption } from '../hooks/useAcpSessions';
import type { AcpEngine } from '../hooks/session-engine/useAcpEngine';
import type { AgentProfile, Session, SlashCommand } from '../types';
import { signInPlaceholder } from './agent-sign-in';

export interface ComposerState {
  controls: ComposerControls;
}

export interface ComposerInputs {
  session: Session | undefined;
  /** The agent the next message goes to when no session is running: a resumed one's, or the default. */
  draftAgent: AgentProfile | undefined;
  acpChoices: AcpChoices;
  setAcpChoices: (choices: AcpChoices) => void;
  agentOptions: Readonly<Record<string, AgentOptions>> | undefined;
  acp: AcpEngine;
  /**
   * Called for every setting the user picks, with the agent it is for: before
   * a session at once, during one once the agent took it, with what it reports.
   */
  onPick?: (profileId: string, configId: string, value: string, reported?: AcpConfigOption[]) => void;
  /** Called for every model the user picks among the agent's `models`, with the agent it is for; in a running session once the agent took it. */
  onPickModel?: (profileId: string, modelId: string) => void;
}

/**
 * What the composer offers: a live ACP session's own modes and options
 * (changed on the fly) or, before the agent runs, the choices for it: the
 * options it reported last time, applied once it is up.
 */
export function composerStateFor(inputs: ComposerInputs): ComposerState {
  const { session, draftAgent, acp } = inputs;
  if (session?.status === 'running') {
    const info = acp.info[session.id];
    const controls = info
      ? acpControls(info, {
          setMode: (modeId) => acp.setMode(session.id, modeId),
          setModel: (modelId) => {
            void acp.setModel(session.id, modelId).then((isTaken) => {
              if (isTaken) inputs.onPickModel?.(session.profileId, modelId);
            });
          },
          setConfigOption: (configId, value) => {
            void acp.setConfigOption(session.id, configId, value).then((reported) => {
              if (reported) inputs.onPick?.(session.profileId, configId, value, reported);
            });
          },
        })
      : {};
    return { controls };
  }
  if (!draftAgent) return { controls: {} };
  const options = inputs.agentOptions?.[draftAgent.id];
  if (!options) return { controls: {} };
  const { acpChoices: choices, setAcpChoices } = inputs;
  const controls = acpControls(draftInfo(options, choices), {
    setMode: (modeId) => setAcpChoices({ ...choices, modeId }),
    setModel: (modelId) => {
      setAcpChoices({ ...choices, modelId });
      inputs.onPickModel?.(draftAgent.id, modelId);
    },
    setConfigOption: (configId, value) => {
      setAcpChoices({ ...choices, config: { ...choices.config, [configId]: value } });
      inputs.onPick?.(draftAgent.id, configId, value);
    },
  });
  return { controls };
}

export const COMPOSER_PLACEHOLDERS = {
  noWorkspace: 'Open a folder and install an agent to start',
  newSession: 'Message the agent to start a new session...',
  resume: 'Message the agent to continue this session...',
  creatingWorktree: 'Creating a worktree for the session...',
} as const;

const installPlaceholder = (agentName: string, continuesSession: boolean) =>
  `Install ${agentName} to ${continuesSession ? 'continue this session' : 'start a session'}.`;

/**
 * What the empty composer says the next message does; none in a running session. Why Send is
 * blocked (install, sign-in) is not said here but in `composerNote`, which stays while the user types.
 */
export function composerPlaceholder(state: {
  isRunning: boolean;
  isCreatingWorktree: boolean;
  isResumable: boolean;
  canStartSession: boolean;
}): string | undefined {
  if (state.isRunning) return undefined;
  if (state.isCreatingWorktree) return COMPOSER_PLACEHOLDERS.creatingWorktree;
  if (!state.isResumable && !state.canStartSession) return COMPOSER_PLACEHOLDERS.noWorkspace;
  return state.isResumable ? COMPOSER_PLACEHOLDERS.resume : COMPOSER_PLACEHOLDERS.newSession;
}

/**
 * The line under the prompt: why Send is blocked, else that the agent's options are loading. The
 * reason stays while the user types (the placeholder does not), and outranks the loading line.
 */
export function composerNote(state: {
  /** The draft agent's name while it must be installed before a message can be sent. */
  agentToInstall?: string;
  /** The draft agent's name while its sign-in panel is open. */
  agentToSignIn?: string;
  /** The next message continues a session rather than starting one. */
  continuesSession: boolean;
  /** The draft agent's name while its models and commands are being asked for. */
  agentLoading?: string;
}): string | undefined {
  if (state.agentToInstall) return installPlaceholder(state.agentToInstall, state.continuesSession);
  if (state.agentToSignIn) return signInPlaceholder(state.agentToSignIn, state.continuesSession);
  if (state.agentLoading) return `Loading ${state.agentLoading}'s models and commands…`;
  return undefined;
}

/**
 * The slash commands the composer offers: a live ACP session's own; before
 * it runs, the ones its agent offered last time.
 */
export function composerCommandsFor(inputs: {
  isRunning: boolean;
  liveCommands: SlashCommand[] | undefined;
  draftAgent: AgentProfile | undefined;
  agentOptions: Readonly<Record<string, AgentOptions>> | undefined;
}): SlashCommand[] | undefined {
  if (inputs.isRunning) return inputs.liveCommands;
  const agent = inputs.draftAgent;
  return agent ? inputs.agentOptions?.[agent.id]?.commands : undefined;
}
