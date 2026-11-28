import { useState } from "react";
import { createPortal } from "react-dom";
import { AuthPanel } from "./AuthPanel";
import { TerminalSignInDialog } from "./TerminalSignInDialog";
import { authCopy } from "../lib/acp-auth";
import type { useAgentSignIn } from "../hooks/useAgentSignIn";
import type { AgentProfile } from "../types";

export interface SignInLayerProps {
  signIn: ReturnType<typeof useAgentSignIn>;
  agents: AgentProfile[];
  /** The agent of the session or draft on screen: another agent's request waits until it is shown. */
  agentId: string | undefined;
  /** False while Settings is open: it draws the login's dialog itself, above its own panel. */
  showTerminal?: boolean;
  /**
   * Where the panel goes instead of here: a draft's slot between its chips and its card. Only the panel moves;
   * the live region and the login's dialog stay mounted here, so nothing is lost when the draft becomes a session.
   */
  panelTarget?: HTMLElement | null;
  /**
   * The login dialog's Cancel and done button, for a login that may have started outside the draft (Settings,
   * the Agents menu): those also clear the request a cancelled login leaves. The draft's own are used without them.
   */
  onCancelLogin?: () => void;
  onFinishLogin?: () => void;
  /** Try again for a login started outside the draft, which this layer did not see start. */
  onRetryLogin?: () => void;
}

/** The sign-in panel above the chat, and an agent's terminal login over the app while it runs. */
export function SignInLayer({ signIn, agents, agentId, showTerminal = true, panelTarget, onCancelLogin, onFinishLogin, onRetryLogin }: SignInLayerProps) {
  const { auth, cancelDialog, closeDialog, terminal } = signIn;
  const { authRequest } = auth;
  // The method the dialog's Try again runs once more.
  const [methodId, setMethodId] = useState<string | null>(null);

  const signInWith = (id: string) => {
    setMethodId(id);
    auth.signIn(id);
  };
  // A method the agent no longer offers cannot be tried again: its dialog offers Close only.
  const retryId = methodId !== null && authRequest?.methods.some((m) => m.id === methodId) ? methodId : null;
  // A login started from a row (Settings, the Agents menu) is retried and ended there; the draft's here.
  const isOutside = authRequest?.isOutside === true;
  // The request stays: switching back to its agent shows the panel again.
  // A sign-in started from a row shows in that row; the panel stays for one that carries a refused message.
  const isForVisibleAgent = authRequest !== null && authRequest.profileId === agentId && (!isOutside || authRequest.pending !== undefined);
  const agentName = authRequest ? (agents.find((a) => a.id === authRequest.profileId)?.name ?? authRequest.profileId) : "";
  // Said when the panel appears: a live region that is already there announces what it is given, a new one does not.
  const appeared = authRequest && isForVisibleAgent && authRequest.status !== "signed-in" ? `Sign-in needed. ${authCopy(agentName, authRequest.methods).lead}` : "";
  const panel =
    authRequest && isForVisibleAgent ? (
      <AuthPanel
        agentName={agentName}
        profileId={authRequest.profileId}
        methods={authRequest.methods}
        status={authRequest.status}
        error={authRequest.error}
        hasReturnedMessage={authRequest.pending !== undefined}
        onSignIn={signInWith}
        onCheckAgain={auth.recheck}
        onDismiss={auth.dismiss}
      />
    ) : null;

  return (
    <>
      <p role="status" className="sr-only">
        {appeared}
      </p>
      {panel && (panelTarget ? createPortal(panel, panelTarget) : panel)}
      {terminal.dialog && showTerminal && (
        <TerminalSignInDialog
          state={terminal.dialog}
          profileId={authRequest?.profileId}
          output={terminal.output}
          onClose={(isOutside ? onCancelLogin : undefined) ?? cancelDialog}
          onDone={(isOutside ? onFinishLogin : undefined) ?? closeDialog}
          onTryAgain={isOutside ? onRetryLogin : retryId ? () => auth.signIn(retryId) : undefined}
          onInput={terminal.sendInput}
          onResize={terminal.resize}
        />
      )}
    </>
  );
}
