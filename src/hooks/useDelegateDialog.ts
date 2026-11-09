import { useRef, useState, type RefObject } from 'react';
import type { ComposerHandle } from '../components/ComposerDock';
import type { DraftControls } from '../components/delegation/DelegateDialog';
import { NO_CHOICES, draftInfo, type AcpChoices, type AgentOptions } from '../lib/acp-draft';
import { acpControls } from '../lib/composer-controls';
import { delegationChoicesFor, mergeChoices } from '../lib/delegation-start';
import type { AgentProfile } from '../types';

/** How the delegate dialog was opened, and what it carries. */
export interface DelegateDialogState {
  /** From Change: the agent the mention named. */
  initialAgentId?: string;
  /** From Change: the task after the mention. */
  initialTask?: string;
  /** The composer's attachments when Change opened it: they go with B's first message. */
  attachments?: readonly string[];
  /** Delegating clears the composer, since the message left it for the dialog (Change). */
  clearsComposer: boolean;
  /** Closing puts focus back on the ⋯ button (the menu item opened it). */
  returnsFocusToMenu: boolean;
}

export interface DelegateDialogDeps {
  agents: readonly AgentProfile[];
  agentOptions: Readonly<Record<string, AgentOptions>> | undefined;
  /** Asks an agent whose options are unknown, when a chip opens; never on mount. */
  probe: { ask: (profileId: string) => void; stateOf: (profileId: string) => DraftControls['status'] };
  /** The session on screen, which delegates. */
  sourceId: string | undefined;
  start: (
    sourceId: string,
    agentId: string,
    task: string,
    options?: { attachments?: readonly string[]; choices?: AcpChoices },
  ) => Promise<boolean>;
  composerRef: RefObject<ComposerHandle | null>;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
}

/**
 * The delegate dialog's state: whether it is open and how, the picks its chips
 * made per agent, the chips themselves, and the Delegate that starts B with them.
 */
export function useDelegateDialog(deps: DelegateDialogDeps) {
  const [dialog, setDialog] = useState<DelegateDialogState | null>(null);
  // The chips' picks per agent; a ref, since a pick re-renders the dialog, which reads them back.
  const picksRef = useRef<Readonly<Record<string, AcpChoices>>>({});

  const picksFor = (agentId: string): AcpChoices => picksRef.current[agentId] ?? NO_CHOICES;
  /** Records a chip's pick, since the dialog passes only mode and model in its own choices. */
  const recordPick = (agentId: string, patch: Partial<AcpChoices>) => {
    const current = picksFor(agentId);
    picksRef.current = {
      ...picksRef.current,
      [agentId]: mergeChoices(current, { ...current, ...patch, config: patch.config ?? {} }),
    };
  };

  const open = (state: DelegateDialogState) => {
    // The chips' picks belong to the dialog that made them.
    picksRef.current = {};
    setDialog(state);
  };

  /** Closes the dialog; Cancel from the ⋯ item puts focus back on its button. */
  const close = () => {
    const isReturningToMenu = dialog?.returnsFocusToMenu === true;
    setDialog(null);
    if (isReturningToMenu) requestAnimationFrame(() => deps.menuButtonRef.current?.focus());
  };

  /** What the dialog's chips are made from: the agent's reported options and the picks made so far. */
  const controlsFor = (agentId: string): DraftControls => {
    const agentName = deps.agents.find((agent) => agent.id === agentId)?.name ?? agentId;
    const onOpen = () => deps.probe.ask(agentId);
    const status = deps.probe.stateOf(agentId);
    const options = deps.agentOptions?.[agentId];
    if (options === undefined) {
      return { agentName, onOpen, ...(status !== undefined ? { status } : {}) };
    }
    const controls = acpControls(draftInfo(options, delegationChoicesFor(options, picksFor(agentId))), {
      setMode: (modeId) => recordPick(agentId, { modeId }),
      setModel: (modelId) => recordPick(agentId, { modelId }),
      setConfigOption: (configId, value) => recordPick(agentId, { config: { [configId]: value } }),
    });
    return {
      agentName,
      controls,
      // A config-mode agent's mode pick is a config change, recorded above; it must not also go out as a modeId.
      modeKind: options.modes ? 'modes' : 'config',
      onOpen,
      ...(status !== undefined ? { status } : {}),
    };
  };

  /** Starts B with the dialog's picks, then clears the composer when Change opened it. */
  const delegate = (agentId: string, task: string, choices: AcpChoices) => {
    const { sourceId } = deps;
    const isFromChange = dialog?.clearsComposer === true;
    // Change carried what the composer held: B's first message keeps the attachments.
    const attachments = dialog?.attachments;
    const merged = mergeChoices(picksFor(agentId), choices);
    setDialog(null);
    if (sourceId === undefined) return;
    const startChoices = delegationChoicesFor(deps.agentOptions?.[agentId], merged);
    void deps.start(sourceId, agentId, task, { choices: startChoices, attachments }).then((isStarted) => {
      if (isStarted && isFromChange) deps.composerRef.current?.clear();
    });
  };

  return { dialog, open, close, controlsFor, delegate };
}
