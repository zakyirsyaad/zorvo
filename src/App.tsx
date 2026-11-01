import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { ChatCanvas } from "./components/ChatCanvas";
import { HistoryElsewhereNote } from "./components/chat/HistoryElsewhereNote";
import { ComposerDock, type ComposerHandle } from "./components/ComposerDock";
import { RemovedAgentPanel } from "./components/RemovedAgentPanel";
import { FilesPanel } from "./components/FilesPanel";
import { EmptySessionState, FileDropOverlay, NoticeBanner } from "./components/AppPlaceholders";
import { CompareRunPanel } from "./components/compare/CompareRunPanel";
import { FailedTurnBanner } from "./components/FailedTurnBanner";
import { SignInLayer } from "./components/SignInLayer";
import { AgentInstallPanel } from "./components/AgentInstallPanel";
import { pickerLabelOf } from "./lib/install-plan";
import { installPanelAgentOf } from "./lib/install-panel";
import { NewSessionView } from "./components/workspace/NewSessionView";
import { WorkspaceSummary } from "./components/workspace/WorkspaceSummary";
import { ChangesPanel } from "./components/changes/ChangesPanel";
import { DiffView } from "./components/changes/DiffView";
import { totalsOf } from "./lib/diff-stats";
import { useSidePanel } from "./hooks/useSidePanel";
import { useReviewComments } from "./hooks/useReviewComments";
import { useReviewWiring } from "./hooks/useReviewWiring";
import { useTurnsEnded } from "./hooks/useTurnsEnded";
import { usePullRequest } from "./hooks/usePullRequest";
import { currentPlan } from "./lib/plan";
import { useRepoPullRequests } from "./hooks/useRepoPullRequests";
import { useAgentSignIn } from "./hooks/useAgentSignIn";
import { useAgentSignInStatus } from "./hooks/useAgentSignInStatus";
import { useDraftAgentCheck } from "./hooks/useDraftAgentCheck";
import { useSettingsSignIn } from "./hooks/useSettingsSignIn";
import { useLatest } from "./hooks/useLatest";
import { attachmentsFor, createSessionWorktree } from "./lib/session-worktree";
import { sweepOrphans } from "./lib/orphan-sweep";
import {
  isWaitingForAnswer,
  newSessionRecord,
  titleFor,
  type SessionSpec,
  type StartSessionOptions,
} from "./lib/session-start";
import { isAwaitingUser } from "./lib/acp-elicitation";
import {
  folderNameOf,
  isListed,
  isAutoName,
  workspacePathOf,
  mostRecentSessionId,
  nextSessionName,
  patchSessionIn,
} from "./lib/session-helpers";
import { useAppearance } from "./hooks/useAppearance";
import { usePersistedState } from "./hooks/usePersistedState";
import { useBackgroundTasks } from "./hooks/useBackgroundTasks";
import { useTranscripts } from "./hooks/useTranscripts";
import { useAgentProfiles, useSuggestedFolders } from "./hooks/useDiscovery";
import { useDraftInstall } from "./hooks/useDraftInstall";
import { useWorkspaceSelection } from "./hooks/useWorkspaceSelection";
import { AgentCatalogPanel } from "./components/agents/AgentCatalogPanel";
import { Onboarding, type OnboardingResult } from "./components/Onboarding";
import { AppSettingsDialog, type SettingsTab } from "./components/AppSettingsDialog";
import { useAgentCatalog } from "./hooks/useAgentCatalog";
import { useAgentCatalogActions } from "./hooks/useAgentCatalogActions";
import { useAutoEnabledAgents } from "./hooks/useAutoEnabledAgents";
import { useShellActions } from "./hooks/useShellActions";
import { useAgentUpdates } from "./hooks/useAgentUpdates";
import { UpdateNotice } from "./components/UpdateNotice";
import { AppUpdateNotice } from "./components/AppUpdateNotice";
import { useAppUpdate } from "./hooks/useAppUpdate";
import { ProfileFooter } from "./components/ProfileFooter";
import { useNavigationHistory } from "./hooks/useNavigationHistory";
import { useUserProfile } from "./hooks/useUserProfile";
import { useGithubConnection } from "./hooks/useGithubConnection";
import { useWorkspaceDetails } from "./hooks/useWorkspaceDetails";
import { useBranchPicker } from "./hooks/useBranchPicker";
import { usePopoutHost } from "./hooks/usePopoutHost";
import { useSessionActions } from "./hooks/useSessionActions";
import { useWorkspaceTerminals } from "./hooks/useWorkspaceTerminals";
import { useTerminalDrawer } from "./hooks/useTerminalDrawer";
import { TerminalDrawer } from "./components/terminal/TerminalDrawer";
import { useDraftSessionList } from "./hooks/useDraftSessionList";
import type { OpenNewSessionOptions } from "./hooks/useSessionImport";
import { useSessionFork } from "./hooks/useSessionFork";
import { useSessionRewind } from "./hooks/useSessionRewind";
import { useUnreadMarks } from "./hooks/useUnreadMarks";
import { useAcpEngine, type AttentionReason, type FirstMessage } from "./hooks/session-engine/useAcpEngine";
import type { AcpConfigOption } from "./hooks/useAcpSessions";
import { attentionBody, notifyIfAway } from "./lib/notify";
import { pickFiles } from "./lib/file-picker";
import { useFileDrop } from "./hooks/useFileDrop";
import { isAgentReady, isAgentRunnable, noAgentNotice, resolveDraftAgentId } from "./lib/agent-readiness";
import { isInUse, removedAgentNameFor } from "./lib/enabled-agents";
import { useCompareDraft } from "./hooks/useCompareDraft";
import { useCompareRun, useCompareRunRows } from "./hooks/useCompareRun";
import { lastOfRun, runOf } from "./lib/compare-run";
import { compareAgentOptions } from "./lib/composer-controls";
import { composerCommandsFor, composerNote, composerPlaceholder, composerStateFor } from "./lib/composer-state";
import {
  NO_CHOICES,
  rememberedChoice,
  withPreferred,
  withProbed,
  withRewound,
  type AcpChoices,
  type AgentOptions,
  type ProbedOptions,
} from "./lib/acp-draft";
import type { ReviewComment, Session, SessionWorktree, Settings } from "./types";

const NO_FOLDER_NOTICE = "Open a project folder first: use the Open folder button next to Workspaces.";

// eslint-disable-next-line no-control-regex -- matching control characters is the point.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export default function App() {
  const [notice, setNotice] = useState<string | null>(null);
  /** The error each session's last turn failed with, shown with a way to try again while that session is open. */
  const [failedTurns, setFailedTurns] = useState<Readonly<Record<string, string>>>({});
  const clearFailedTurn = (sessionId: string) =>
    setFailedTurns((prev) => {
      if (!(sessionId in prev)) return prev;
      const { [sessionId]: _cleared, ...rest } = prev;
      return rest;
    });
  const [selectedSessionId, setActiveSessionId] = useState("");
  /** The compare run a Send opened; set only while no session is selected. */
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  /** Bumped when any turn ends, so an open run's panel reads each agent's changes again. */
  const [runVersion, setRunVersion] = useState(0);
  /** The agent picked for the next new session; null means the default from Settings. */
  const [pickedAgentId, setPickedAgentId] = useState<string | null>(null);
  /** Whether the next new session runs in its own worktree (a git repository only). */
  const [isWorktreeOn, setIsWorktreeOn] = useState(false);
  const [isCreatingWorktree, setIsCreatingWorktree] = useState(false);
  /** Bumped after each of the active agent's turns, so its folder's branch is read again. */
  const [branchCheck, setBranchCheck] = useState(0);
  const [acpChoices, setAcpChoices] = useState<AcpChoices>(NO_CHOICES);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const composerRef = useRef<ComposerHandle>(null);

  const reportError = useCallback((message: string) => setNotice(message), []);
  const { state, isLoaded, updateState, getState, saveNow } = usePersistedState(reportError);
  useAppearance(state.settings.appearance, isLoaded, reportError);
  const { transcripts, ensureLoaded, updateMessages, removeTranscript, flush: flushTranscripts } = useTranscripts(reportError);
  const { agents, isLoaded: areAgentsLoaded, refresh: refreshAgents, reload: reloadAgents } = useAgentProfiles(reportError);
  const agentCatalog = useAgentCatalog();
  const shell = useShellActions(setNotice);
  // An update restarts Zorvo without closing the page, so its exit handlers never write what is still waiting for a timer.
  const writePendingBeforeRestart = useCallback(
    () => Promise.all([saveNow(), flushTranscripts()]).then(() => undefined),
    [saveNow, flushTranscripts],
  );
  const appUpdate = useAppUpdate(reportError, writePendingBeforeRestart);
  const agentUpdates = useAgentUpdates({ catalog: agentCatalog.catalog, settings: state.settings, isLoaded, updateState });
  useAutoEnabledAgents(agents, isLoaded, updateState);
  const suggestedFolders = useSuggestedFolders();
  const userProfile = useUserProfile();
  const github = useGithubConnection();
  // What stops pull requests being read, when the GitHub connection explains it.
  const githubBlocker =
    github.status?.state === "not-installed" || github.status?.state === "signed-out" ? github.status.state : undefined;
  const navigation = useNavigationHistory();
  const {
    workspaces,
    activeWorkspace,
    activeWorkspacePath,
    selectWorkspace,
    rememberFolder,
    openFolder,
    removeFolder,
  } = useWorkspaceSelection(state, isLoaded, updateState, reportError);

  const sessions = state.sessions;
  // An opened run shows its panel in the chat's place, until a session is selected.
  const activeRun = activeRunId && !selectedSessionId ? runOf(sessions, activeRunId) : null;
  const activeSessionId = selectedSessionId;
  // Any selection leaves the run, and so does a run that is gone (archived or deleted away): it does not come back on its own.
  if (activeRunId && (selectedSessionId || !runOf(sessions, activeRunId))) {
    setActiveRunId(null);
    // The agent left takes the panel's place in this same render, so no draft mounts behind it.
    const last = selectedSessionId ? null : lastOfRun(sessions, activeRunId);
    if (last) setActiveSessionId(last.id);
  }
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeAgent = agents.find((a) => a.id === activeSession?.profileId);
  const isActiveRunning = activeSession?.status === "running";
  // Only the agents in use are offered: the defaults and installed ones.
  const agentsInUse = agents.filter((agent) => isInUse(agent, state.settings));
  // A saved session of a removed agent stays readable; once it stops, its composer offers to add the agent again.
  const activeAgentRemoved = removedAgentNameFor(activeSession, agents, state.settings);
  // An agent not installed yet is offered too: picking it shows its Install panel.
  const pickableAgents = agentsInUse;
  const defaultAgentId = resolveDraftAgentId(agentsInUse, state.settings.defaultAgentId, pickableAgents);
  const primaryAgentId = pickableAgents.find((a) => a.id === pickedAgentId)?.id ?? defaultAgentId;
  // No session is selected and no run is open: the window shows a new one, not started until its first message.
  const isNewSessionDraft = !activeSession && !activeRun;
  // A session shows the folder it runs in, even one no longer in the recents.
  const shownFolderPath = activeSession?.cwd ?? activeWorkspacePath;
  const workspaceDetails = useWorkspaceDetails(shownFolderPath, reportError, branchCheck);
  // Only a repository on github.com has pull requests to miss: the Changes panel says why it shows none, there only.
  const githubProblem = workspaceDetails?.hasGithubRemote ? githubBlocker : undefined;
  // Files and Reveal act on the folder the top bar names. The backend browses
  // every saved session's folder, so one gone from the recents keeps them.
  const isRepository = Boolean(workspaceDetails?.branch);
  const canUseWorktree = isNewSessionDraft && isRepository;
  // In a repository the Agent chip can tick several agents; the first ticked one is the draft's agent.
  const signInStatus = useAgentSignInStatus({ settings: state.settings, updateState });
  const agentChoices = compareAgentOptions(pickableAgents, signInStatus.stateOf);
  const tickableAgentIds = new Set(agentChoices.filter((c) => !c.disabledReason).map((c) => c.value));
  // Details are null while a folder loads, which says nothing about it: compare keeps the last known answer until the folder's own arrives.
  const [lastDetails, setLastDetails] = useState(workspaceDetails);
  if (isNewSessionDraft && workspaceDetails && workspaceDetails !== lastDetails) setLastDetails(workspaceDetails);
  const canCompare = isNewSessionDraft && Boolean((workspaceDetails ?? lastDetails)?.branch);
  const compare = useCompareDraft({
    primaryAgentId,
    isRepository: canCompare,
    isTickable: (agentId) => tickableAgentIds.has(agentId),
    onSingle: setPickedAgentId,
  });
  const newSessionAgent = agents.find((a) => a.id === (compare.agentIds[0] ?? primaryAgentId));
  // Several agents each run in their own worktree, so Worktree is on whatever it was set to.
  const isWorktreeActive = canUseWorktree && (isWorktreeOn || compare.isCompare);
  const branchPicker = useBranchPicker({
    folderPath: isNewSessionDraft ? activeWorkspacePath : undefined,
    checkedOut: workspaceDetails?.branch ?? undefined,
    isWorktreeOn: isWorktreeActive,
    onSwitched: () => setBranchCheck((n) => n + 1),
    onNotice: setNotice,
  });
  const filesFolder =
    workspaces.find((ws) => ws.path === shownFolderPath) ??
    (activeSession ? { name: folderNameOf(activeSession.cwd), path: activeSession.cwd } : undefined);

  // An ended ACP session continues with its own agent: in the agent's own
  // session when it has one, else (rewound) in a fresh one handed the conversation.
  const isResumable =
    Boolean(activeSession) && activeSession?.status !== "running" && activeAgent?.detected === true;
  // A run's panel has no draft behind it: no install or sign-in panel, no probe.
  const draftAgent = activeRun ? undefined : isResumable ? activeAgent : newSessionAgent;
  const isDraftAgentReady = draftAgent ? isAgentRunnable(draftAgent) : false;
  const installPanelAgent = activeRun ? undefined : installPanelAgentOf(activeSession, activeAgent, newSessionAgent);
  const draftNeedsInstall = useDraftInstall(agents, installPanelAgent, draftAgent);

  useEffect(() => setAcpChoices(NO_CHOICES), [draftAgent?.id]);

  // Agents a previous UI left running (a webview reload keeps the backend
  // alive) are unknown to this one, which shows their sessions as ended;
  // end them so a resume does not collide with a still-open session.
  useEffect(() => {
    sweepOrphans().catch((error) => {
      setNotice(`Could not stop agents left from before: ${String(error)}`);
    });
  }, []);

  // Once saved sessions are loaded, show the most recent one.
  useEffect(() => {
    if (isLoaded) setActiveSessionId((current) => current || mostRecentSessionId(state.sessions.filter(isListed)));
    // Only on the load transition; later session changes must not move the selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  const visitSession = navigation.visit;
  useEffect(() => {
    if (!activeSessionId) return;
    ensureLoaded(activeSessionId);
    visitSession(activeSessionId);
  }, [activeSessionId, ensureLoaded, visitSession]);

  const patchSession = useCallback(
    (sessionId: string, patch: Partial<Session>) =>
      updateState((prev) => patchSessionIn(prev, sessionId, patch)),
    [updateState],
  );

  const updateReviewComments = useCallback(
    (sessionId: string, change: (prev: ReviewComment[]) => ReviewComment[]) =>
      updateState((prev) => ({
        ...prev,
        sessions: prev.sessions.map((s) => (s.id === sessionId ? { ...s, reviewComments: change(s.reviewComments ?? []) } : s)),
      })),
    [updateState],
  );
  const reviewComments = useReviewComments(activeSession?.id, activeSession?.reviewComments, updateReviewComments);
  const unsentCommentCount = reviewComments.comments.filter((comment) => comment.sentAt === undefined).length;

  const rememberAgentOptions = (profileId: string, options: Partial<AgentOptions>) =>
    updateState((prev) => {
      const known = prev.agentOptions?.[profileId] ?? { modes: null, configOptions: [] };
      return { ...prev, agentOptions: { ...prev.agentOptions, [profileId]: { ...known, ...options } } };
    });

  /** Keeps a model or effort pick (as the agent settled it), so the agent's next session starts with it too. */
  const rememberPick = (profileId: string, configId: string, value: string, reported?: AcpConfigOption[]) => {
    const preferredConfig = rememberedChoice(state.agentOptions?.[profileId], configId, value, reported);
    if (!preferredConfig) return;
    // The lists on offer follow too (an effort list depends on its model), so the next draft offers the same.
    rememberAgentOptions(profileId, { preferredConfig, ...(reported?.length ? { configOptions: reported } : {}) });
  };

  /** Keeps a model pick among an agent's `models`, so the agent's next session starts with it too. */
  const rememberModelPick = (profileId: string, preferredModelId: string) =>
    rememberAgentOptions(profileId, { preferredModelId });

  const isRunPanelRef = useLatest(Boolean(activeRun));
  // The user may have opened another session meanwhile: the message goes back
  // into the session it was written for, not that one's composer.
  const restoreMessage = (sessionId: string, text: string, attachments?: readonly string[]) => {
    setActiveSessionId(sessionId);
    // A run's panel hides the composer: the message waits for it to show, where it can take the focus.
    if (composerRef.current && !isRunPanelRef.current) composerRef.current.restore(text, attachments);
    else pendingRestoreRef.current = { text, attachments };
  };
  // Read when an agent answers, seconds after the closure that waits for it was made.
  const activeSessionIdRef = useLatest(activeSessionId);
  const signIn = useAgentSignIn({
    onSignInNeeded: signInStatus.markNeeded,
    onSignedIn: signInStatus.markSignedIn,
    onSignInBlocked: reportError,
    onRefusedMessageChanged: (sessionId) => compareRun.dropSignIn(sessionId),
    agents,
    composerRef,
    activeSessionIdRef,
    retryAfterSignIn: (sessionId, message) => {
      compareRun.dropSignIn(sessionId);
      return acp.retryAfterSignIn(sessionId, message);
    },
    onRestore: restoreMessage,
  });

  const rememberProbed = (profileId: string, probed: ProbedOptions) =>
    updateState((prev) => ({
      ...prev,
      agentOptions: { ...prev.agentOptions, [profileId]: withProbed(prev.agentOptions?.[profileId], probed) },
    }));
  // Settings → Agents shows the same sign-in state as the sidebar, and checks and fixes it.
  const settingsSignIn = useSettingsSignIn({
    cwd: shownFolderPath ?? workspaces[0]?.path,
    agents,
    agentOptions: state.agentOptions,
    rememberProbed,
    status: signInStatus,
    signIn,
  });

  // A draft asks its ACP agent what it offers, and whether it needs a sign-in, before the first message.
  const agentCheck = useDraftAgentCheck({
    // Several agents are not asked: nothing starts until Send, and the chips they feed are hidden.
    agent: isActiveRunning || !isDraftAgentReady || compare.isCompare ? undefined : draftAgent,
    cwd: shownFolderPath ?? undefined,
    agentOptions: state.agentOptions,
    rememberProbed,
    auth: signIn.auth,
    onSignedIn: signInStatus.markSignedIn,
  });
  // Its sign-in panel is open (and not yet done): a message would only be refused.
  const draftNeedsSignIn =
    draftAgent !== undefined &&
    signIn.auth.authRequest?.profileId === draftAgent.id &&
    signIn.auth.authRequest.status !== "signed-in";

  const engineDeps = { sessions, agents, updateMessages, patchSession, reportError };
  const acp = useAcpEngine({
    ...engineDeps,
    transcripts,
    rememberOptions: rememberAgentOptions,
    onAttention: (id, reason) => { notifyAttention(id, reason); if (reason !== "needs-answer") setRunVersion((n) => n + 1); },
    onAuthRequired: (session, methods, unsent) => {
      if (!compareRun.isInRun(session.id)) {
        signIn.handBack(session, methods, unsent);
        return;
      }
      // Several agents of a run can be refused at once and its panel has no composer: each waits on its row.
      signInStatus.markNeeded(session.profileId);
      compareRun.keepSignIn(session.id, { methods, unsent });
    },
    onTurnFailed: (sessionId, error) =>
      error ? setFailedTurns((prev) => ({ ...prev, [sessionId]: error })) : clearFailedTurn(sessionId),
  });
  // The one instance of Add, Update and Remove: Settings, saved sessions of a removed agent and popouts use it.
  const catalogActions = useAgentCatalogActions({
    updateState, saveNow, agents, sessions, stopSession: acp.stop, reloadAgents, catalog: agentCatalog,
  });

  /** Tells a user who is away that a session needs them or is done. */
  const notifyAttention = (sessionId: string, reason: AttentionReason) => {
    if (reason === "finished" && compareRun.awaitsRunNotice(sessionId)) return;
    const session = sessionById(sessionId);
    const agentName = agents.find((a) => a.id === session?.profileId)?.name ?? "The agent";
    // A notification that cannot be shown is not worth an error banner: the chat has it all.
    notifyIfAway({ title: session?.name ?? agentName, body: attentionBody(agentName, reason) }).catch(() => {});
  };

  const sessionById = (sessionId: string) => sessions.find((s) => s.id === sessionId);
  const { rewind, restart, isRestarting, cancelRestart, rewoundOptionsOf } = useSessionRewind({
    agents,
    transcripts,
    acp,
    patchSession,
    updateMessages,
    onRestore: restoreMessage,
    onNotice: setNotice,
  });

  const isSessionBusy = (sessionId: string) => acp.isBusy(sessionId) || isRestarting(sessionId);

  // What a new or resumed session starts with: the picks made for it, else the
  // model picked last; a rewound session's fresh agent, the model and effort it
  // ran with, checked against its own lists (another model offers other efforts).
  const rewound = activeSession && isResumable ? rewoundOptionsOf(activeSession.id) : undefined;
  const agentOptions = withRewound(state.agentOptions, draftAgent?.id, rewound);
  const startChoices = draftAgent ? withPreferred(acpChoices, agentOptions?.[draftAgent.id]) : acpChoices;

  /** A run's panel shows no message, so nothing goes into one unseen. */
  const insertPaths = (paths: string[]) => {
    if (!activeRun) composerRef.current?.insertPaths(paths);
  };

  /** Dropped files are added to the message; a name with control characters is left out. */
  const handleDroppedFiles = (dropped: string[]) => {
    const paths = dropped.filter((path) => !CONTROL_CHARACTER.test(path));
    if (paths.length < dropped.length) {
      setNotice("Left out a dropped file whose name has control characters.");
    }
    if (paths.length === 0) return;
    insertPaths(paths);
  };
  const isDraggingFiles = useFileDrop(handleDroppedFiles, reportError);

  const turnsEnded = useTurnsEnded(Boolean(activeSessionId) && isSessionBusy(activeSessionId));
  const sidePanel = useSidePanel(filesFolder?.path, isRepository, turnsEnded, reportError);
  const diffStats = sidePanel.headStats ? totalsOf(sidePanel.headStats) : undefined;
  // The commit this session's worktree began at: the diff can compare with it, and the chip stays for it.
  const startCommit = activeSession?.worktree?.startCommit;
  // The folder whose diff view is expanded: another folder's view starts unexpanded.
  const [expandedDiffFolder, setExpandedDiffFolder] = useState<string | null>(null);
  const isDiffOpen = sidePanel.open === "diff" && Boolean(filesFolder) && isRepository;
  const isDiffExpanded = isDiffOpen && expandedDiffFolder === filesFolder?.path;
  // An expanded diff view starts over the next time it opens.
  useEffect(() => {
    if (!isDiffOpen) setExpandedDiffFolder(null);
  }, [isDiffOpen]);
  const pullRequest = usePullRequest(
    isRepository ? shownFolderPath : undefined,
    workspaceDetails?.branch ?? undefined,
    turnsEnded,
  );
  // Read only while the Changes panel shows them.
  const repoPullRequests = useRepoPullRequests(
    sidePanel.open === "changes" && isRepository ? filesFolder?.path : undefined,
    turnsEnded,
    // The panel already says gh is missing or signed out and points to Settings; gh's own error would only repeat it.
    githubProblem ? () => {} : reportError,
  );
  const openPullRequest = (url: string) => {
    invoke("open_external_url", { url }).catch((error) => setNotice(`Could not open the pull request: ${String(error)}`));
  };
  const openLink = (url: string) => {
    invoke("open_external_url", { url }).catch((error) => setNotice(`Could not open the link: ${String(error)}`));
  };
  // The agent may have checked out another branch: the top bar reads it again after each turn.
  useEffect(() => setBranchCheck(turnsEnded), [turnsEnded]);
  const isSessionWaiting = (sessionId: string) =>
    isWaitingForAnswer(sessionById(sessionId), transcripts[sessionId] ?? [], () => isSessionBusy(sessionId));

  /** Records a new session and shows it, unless `focus` is false; the agent is started by its engine. */
  const recordSession = (spec: SessionSpec, options?: { focus?: boolean }): Session => {
    const session = newSessionRecord(spec);
    const { initialMessages } = spec;
    updateState((prev) => ({ ...prev, sessions: [session, ...prev.sessions] }));
    if (initialMessages) updateMessages(session.id, () => initialMessages);
    if (options?.focus !== false) setActiveSessionId(session.id);
    return session;
  };

  /**
   * Starts a session. A compare run passes the `choices` of this session's own agent (the draft's belong to
   * the draft agent) and clears the draft's once after the whole run, and `focus: false` to leave the view alone.
   */
  const startSession = (spec: SessionSpec, first?: FirstMessage, options?: StartSessionOptions) => {
    const session = recordSession(spec, options);
    void acp.start(session, first, options?.choices ?? startChoices);
    // The picks went with the session; a later draft starts from the model picked last.
    if (!options?.choices) setAcpChoices(NO_CHOICES);
  };

  /**
   * Starts a session in the active workspace with the agent picked for it, in
   * a new worktree of it when Worktree is on.
   */
  const handleNewSession = async (first?: FirstMessage) => {
    // The backend rejects relative and missing cwds, so never spawn without a path.
    if (!activeWorkspace) {
      setNotice(NO_FOLDER_NOTICE);
      return;
    }
    if (!newSessionAgent) {
      setNotice(noAgentNotice(agentsInUse));
      return;
    }
    rememberFolder(activeWorkspace);
    const name = first ? titleFor(first) : nextSessionName(sessions);
    let worktree: SessionWorktree | null = null;
    let cwd = activeWorkspace.path;
    let message = first;
    // The composer stays busy until the worktree and its attachments are ready, so a second Send cannot start.
    if (isWorktreeActive) setIsCreatingWorktree(true);
    try {
      if (isWorktreeActive) {
        try {
          ({ worktree, cwd } = await createSessionWorktree(activeWorkspace.path, name, branchPicker.baseBranch));
        } catch (error) {
          setNotice(`Could not create a worktree: ${String(error)}`);
          // The user may have opened another session meanwhile: the message goes
          // back into the new session it was written for, not that one's composer.
          openNewSession(activeWorkspace.path, newSessionAgent.id);
          if (first) composerRef.current?.restore(first.text, first.attachments);
          return;
        }
      }
      if (worktree && first?.attachments?.length) {
        // The composer attached paths in the main folder: the agent gets its worktree's files instead.
        try {
          message = { ...first, attachments: await attachmentsFor(activeWorkspace.path, cwd, first.attachments) };
        } catch (error) {
          setNotice(`Could not point the attachments into the worktree: ${String(error)}`);
        }
      }
    } finally {
      setIsCreatingWorktree(false);
    }
    setPickedAgentId(null);
    compare.reset();
    startSession({ agent: newSessionAgent, cwd, name, worktree }, message);
    // The base was this session's: the next draft starts from the folder's own branch.
    if (worktree) branchPicker.reset();
  };

  /** Makes `path` the active workspace; a folder only old sessions still use is added back to the recents. */
  const chooseFolder = (path: string) => {
    if (workspaces.some((ws) => ws.path === path)) selectWorkspace(path);
    else rememberFolder({ name: folderNameOf(path), path });
  };

  /**
   * Shows a new, empty session: the folder and agent can still be changed in
   * the composer, and the agent starts with the first message.
   */
  const openNewSession = (path?: string, agentId?: string, options?: OpenNewSessionOptions) => {
    if (path) chooseFolder(path);
    setPickedAgentId(agentId ?? null);
    compare.reset();
    // A fresh draft: picks left from an earlier one would override the model picked last.
    // A failed import returns to the draft it started from, so its picks stay: it did not open.
    if (!options?.keepChoices) setAcpChoices(NO_CHOICES);
    setActiveSessionId("");
    setActiveRunId(null);
  };

  const forkSession = useSessionFork({
    source: activeSession,
    agents,
    transcripts,
    acp,
    recordSession,
    startSession,
    onNotice: setNotice,
  });

  const handleSelectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    // An agent picked for a new session that was never started is forgotten.
    setPickedAgentId(null);
    compare.reset();
    const selected = sessionById(sessionId);
    const workspacePath = selected && workspacePathOf(selected);
    if (workspacePath && workspaces.some((ws) => ws.path === workspacePath)) selectWorkspace(workspacePath);
  };

  /** Shows a run's panel in the chat's place; no session stays selected, or the panel would not show. */
  const openRun = (runId: string) => {
    setActiveSessionId("");
    setPickedAgentId(null);
    compare.reset();
    setActiveRunId(runId);
    const run = runOf(sessions, runId);
    const workspacePath = run && workspacePathOf(run.sessions[0]);
    if (workspacePath && workspaces.some((ws) => ws.path === workspacePath)) selectWorkspace(workspacePath);
  };

  /** Stops the agent's current turn; the session stays open for the next message. */
  const handleInterrupt = (sessionId: string) => {
    // A rewound session's fresh agent has not started yet: only its start is called off.
    if (isRestarting(sessionId)) cancelRestart(sessionId);
    else acp.interrupt(sessionId, transcripts[sessionId]);
  };

  const backgroundTasks = useBackgroundTasks({
    sessions,
    transcripts,
    isBusy: acp.isBusy,
    busySince: acp.busySinceOf,
    needsApproval: (id) => isAwaitingUser(transcripts[id] ?? []),
    onOpenSession: handleSelectSession,
    stopAgent: handleInterrupt,
    onError: reportError,
  });

  const navigateTo = (sessionId: string | null) => {
    if (sessionId) handleSelectSession(sessionId);
  };

  const updateSettings = (patch: Partial<Settings>) =>
    updateState((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));

  const handleOnboardingComplete = ({ defaultAgentId, folder }: OnboardingResult) => {
    updateSettings({ onboardingCompleted: true, defaultAgentId });
    rememberFolder(folder);
  };

  const handleRunOnboarding = () => {
    setSettingsTab(null);
    updateSettings({ onboardingCompleted: false });
  };

  useUnreadMarks(sessions, activeSessionId, isSessionBusy, patchSession, activeRun?.sessions.map((s) => s.id));

  // A removed session may still have a streamed change queued: drop it before
  // the transcript is deleted, so a late frame cannot write it back.
  const { forgetQueued } = acp;
  const forgetTranscript = useCallback(
    (sessionId: string) => {
      forgetQueued(sessionId);
      removeTranscript(sessionId);
    },
    [forgetQueued, removeTranscript],
  );

  const terminals = useWorkspaceTerminals(setNotice);
  const terminalDrawer = useTerminalDrawer(filesFolder?.path, terminals);

  const sessionActions = useSessionActions({
    sessions,
    setActiveSessionId,
    patchSession,
    updateState,
    updateMessages,
    removeTranscript: forgetTranscript,
    navigation,
    acp,
    closeTerminals: terminals.closeFolder,
    onNotice: setNotice,
  });

  // The draft's list of the agent's own sessions, and the import each row starts.
  const draftSessionList = useDraftSessionList({
    agent: isNewSessionDraft ? newSessionAgent : undefined, cwd: activeWorkspace?.path, sessions,
    activeSessionId,
    isShown: Boolean(isNewSessionDraft && newSessionAgent && agentCheck.canListSessions(newSessionAgent.id) && !isWorktreeActive),
    listSessions: acp.listSessions, acp, choices: startChoices, onChoicesUsed: () => setAcpChoices(NO_CHOICES),
    recordSession, openSession: handleSelectSession, discardSession: sessionActions.discardSession, openNewSession, requestSignIn: signIn.auth.requestSignIn,
  });

  const sendTo = async (sessionId: string, message: FirstMessage) => {
    compareRun.dropSignIn(sessionId);
    const session = sessionById(sessionId);
    // A numbered session takes its title from the first thing the user asks.
    const isFirstMessage = !(transcripts[sessionId]?.some((m) => m.role === "user") ?? false);
    const sent = await acp.send(sessionId, message.text, message.attachments);
    if (sent && session && isFirstMessage && isAutoName(session.name) && !session.namedByUser) {
      patchSession(sessionId, { name: titleFor(message) });
    }
  };

  /**
   * Continues an ended ACP session: a fresh agent process loads it, then gets
   * the message. A rewound one has no agent session left to load.
   */
  const resumeSession = (session: Session, message: FirstMessage) => {
    compareRun.dropSignIn(session.id);
    if (!session.acpSessionId) {
      void restart(session, message, startChoices);
      setAcpChoices(NO_CHOICES);
      return;
    }
    // Continuing an archived session brings it back into the list.
    patchSession(session.id, { status: "running", endedAt: null, exitCode: null, archivedAt: null });
    void acp.resume(session, session.acpSessionId, message, startChoices);
    setAcpChoices(NO_CHOICES);
  };

  // Read when a run's worktrees are done, seconds after the click: an empty session id also means a run's panel.
  const isDraftRef = useLatest(isNewSessionDraft);
  const pendingRestoreRef = useRef<FirstMessage | null>(null);
  useEffect(() => {
    const pending = pendingRestoreRef.current;
    if (!pending || !composerRef.current || activeRun) return;
    pendingRestoreRef.current = null;
    composerRef.current.restore(pending.text, pending.attachments);
  });
  const rowSources = { isBusy: isSessionBusy, transcripts, failedTurns };
  const compareRun = useCompareRun({
    repoPath: activeWorkspace?.path ?? "",
    baseBranch: branchPicker.baseBranch,
    agentOptions: state.agentOptions,
    startSession,
    isOnDraft: () => isDraftRef.current,
    openRun: setActiveRunId,
    setIsBusy: setIsCreatingWorktree,
    // The user may have opened another session meanwhile: the message goes back into the new session it was written for.
    restoreMessage: (message, agentId) => {
      if (!isDraftRef.current || !activeWorkspace) openNewSession(activeWorkspace?.path, agentId);
      // A run's panel hides the composer: the message waits for the new draft to show it.
      if (composerRef.current && !isRunPanelRef.current) composerRef.current.restore(message.text, message.attachments);
      else pendingRestoreRef.current = message;
    },
    onStarted: () => {
      setPickedAgentId(null);
      compare.reset();
      setAcpChoices(NO_CHOICES);
      branchPicker.reset();
    },
    onNotice: setNotice,
    archiveSession: sessionActions.archiveSession,
    readSessions: () => getState().sessions,
    openSession: setActiveSessionId,
    agentName: (profileId) => agents.find((a) => a.id === profileId)?.name ?? "The agent",
    sessions,
    sources: rowSources,
    askSignIn: signIn.handBackKept,
    // A notification that cannot be shown is not worth an error banner: the panel has it all.
    notifyRun: (notice) => void notifyIfAway(notice).catch(() => {}),
  });
  // However a session comes on screen, its refusal is taken up there: only now does its composer exist.
  const { takeSignIn } = compareRun;
  const refusedHere = compareRun.signInNeeded.get(activeSessionId);
  useEffect(() => {
    if (refusedHere) takeSignIn(activeSessionId);
  }, [activeSessionId, refusedHere, takeSignIn]);

  const runRows = useCompareRunRows(activeRun, { ...rowSources, signInNeeded: compareRun.signInNeeded, ensureLoaded });
  /** Starts the ticked agents on one prompt, each in its own worktree. */
  const handleNewRun = (message: FirstMessage) => {
    if (!activeWorkspace) {
      setNotice(NO_FOLDER_NOTICE);
      return;
    }
    rememberFolder(activeWorkspace);
    const picked = compare.agentIds.flatMap((id) => agents.filter((a) => a.id === id));
    void compareRun.startRun(picked, message);
  };

  const canStartSession = Boolean(activeWorkspacePath && newSessionAgent);
  const isComposerDisabled =
    isCreatingWorktree ||
    (!isActiveRunning && ((!isDraftAgentReady && !draftNeedsInstall) || (!isResumable && !canStartSession)));
  const review = useReviewWiring({
    session: activeSession,
    sessions,
    comments: reviewComments,
    updateComments: updateReviewComments,
    composerRef,
    canContinue: isActiveRunning || isResumable,
    hasComposer: activeAgentRemoved === null,
    isComposerDisabled,
    collapseDiff: () => setExpandedDiffFolder(null),
  });

  /** Sends to the active session, continues it when it can be resumed, or starts a new one (or a run). */
  const handleSendMessage = (text: string, attachments?: string[]) => {
    const message = { text, attachments };
    if (activeSession && isActiveRunning) {
      review.sendFrom(activeSession.id);
      void sendTo(activeSession.id, message);
    } else if (activeSession && isResumable) {
      review.sendFrom(activeSession.id);
      resumeSession(activeSession, message);
    } else if (compare.isCompare) handleNewRun(message);
    else void handleNewSession(message);
  };

  const chooseOption = (sessionId: string, cardId: string, optionId: string) =>
    acp.chooseOption(sessionId, transcripts[sessionId], cardId, optionId);

  usePopoutHost({
    sessions,
    transcripts,
    ensureLoaded,
    statusOf: (sessionId) => ({
      isBusy: isSessionBusy(sessionId),
      isWaiting: isSessionWaiting(sessionId),
      contextUsage: acp.info[sessionId]?.usage,
      failures: acp.failuresOf(sessionId),
    }),
    agentCatalog: { agents, settings: state.settings, addAgent: catalogActions.addAgent },
    onAction: (sessionId, action) => {
      if (action.kind === "send") void sendTo(sessionId, { text: action.text });
      else if (action.kind === "stop") handleInterrupt(sessionId);
      else if (action.kind === "answer-elicitation") acp.answerElicitation(sessionId, action.key, action.answer);
      else if (action.kind === "reopen-elicitation-url") acp.reopenElicitationUrl(sessionId, action.key);
      else chooseOption(sessionId, action.cardId, action.optionId);
    },
  });

  // A new session is not in the history: Back from it returns to the session viewed last.
  const lastViewedSessionId = navigation.current && sessionById(navigation.current) ? navigation.current : null;
  const canGoBack = !activeSession ? lastViewedSessionId !== null : navigation.canGoBack;

  const currentMessages = transcripts[activeSessionId] ?? [];
  const sessionPlan = currentPlan(currentMessages);
  const composer = composerStateFor({
    session: activeSession,
    draftAgent,
    acpChoices: startChoices,
    setAcpChoices,
    agentOptions,
    acp,
    onPick: rememberPick,
    onPickModel: rememberModelPick,
  });
  // Several agents are not asked and nothing is picked for them yet: Send only waits for the single agent's install or sign-in.
  // The note promises one worktree each, so while the folder is not known to be a repository (still loading, or unreadable) Send waits too.
  const isSendWaiting = compare.isCompare ? !canUseWorktree : draftNeedsInstall || draftNeedsSignIn;
  const isSendBlocked = isSendWaiting || review.blocksSend;
  const composerCommands = composerCommandsFor({
    isRunning: isActiveRunning,
    liveCommands: acp.info[activeSessionId]?.commands,
    draftAgent,
    agentOptions: state.agentOptions,
  });

  if (isLoaded && !state.settings.onboardingCompleted) {
    return (
      <Onboarding
        agents={agents}
        settings={state.settings}
        recentFolders={workspaces}
        suggestedFolders={suggestedFolders}
        agentsPanel={<AgentCatalogPanel agents={agents} settings={state.settings} refreshAgents={refreshAgents} catalog={agentCatalog} actions={catalogActions} />}
        onPickFolder={openFolder}
        onComplete={handleOnboardingComplete}
      />
    );
  }

  return (
    <main className="flex h-screen w-screen flex-col bg-bg text-fg-secondary">
      <TopBar
        sessionName={activeSession?.name ?? activeRun?.name}
        workspaceName={activeSession ? folderNameOf(workspacePathOf(activeSession)) : activeWorkspace?.name}
        workspacePath={shownFolderPath}
        branch={workspaceDetails?.branch ?? undefined}
        pullRequest={pullRequest}
        onOpenPullRequest={openPullRequest}
        canGoBack={canGoBack}
        canGoForward={navigation.canGoForward}
        onBack={() => navigateTo(!activeSession ? lastViewedSessionId : navigation.back())}
        onForward={() => navigateTo(navigation.forward())}
        onToggleFiles={filesFolder ? () => sidePanel.toggle("files") : undefined}
        isFilesOpen={sidePanel.open === "files" && Boolean(filesFolder)}
        onToggleTerminal={filesFolder ? terminalDrawer.toggle : undefined}
        isTerminalOpen={terminalDrawer.isOpen}
        onToggleChanges={filesFolder && isRepository ? () => sidePanel.toggle("changes") : undefined}
        isChangesOpen={sidePanel.open === "changes" && Boolean(filesFolder) && isRepository}
        diffStats={diffStats}
        isDiffAlwaysShown={Boolean(startCommit) || reviewComments.comments.length > 0}
        diffCommentCount={unsentCommentCount}
        onOpenDiff={() => sidePanel.show("diff")}
        onPopout={activeSession ? () => shell.popout(activeSession.id) : undefined}
        onOpenSettings={() => setSettingsTab("general")}
        backgroundTasks={{
          tasks: backgroundTasks.tasks,
          isOpen: backgroundTasks.isMenuOpen,
          onOpenChange: backgroundTasks.setMenuOpen,
          onOpenTask: backgroundTasks.open,
          onStopTask: backgroundTasks.stop,
        }}
        plan={sessionPlan}
      />

      <section className="flex flex-1 overflow-hidden">
        <Sidebar
          workspaces={workspaces}
          activeWorkspacePath={activeWorkspacePath}
          sessions={sessions}
          activeSessionId={activeSessionId}
          activeRunId={activeRun?.id}
          agents={agents}
          settings={state.settings}
          signInStateOf={signInStatus.stateOf}
          onSetUpAgent={(profileId) => {
            openNewSession(undefined, profileId);
            // Asks again even when this agent is already the draft's: its panel may have been dismissed.
            agentCheck.reprobe(profileId);
          }}
          onNewSession={() => openNewSession()}
          onSelectSession={handleSelectSession}
          onOpenRun={openRun}
          onNewSessionIn={openNewSession}
          defaultAgentId={defaultAgentId ?? undefined}
          onOpenFolder={() => void openFolder()}
          isSessionBusy={isSessionBusy}
          isSessionWaiting={isSessionWaiting}
          onStopSession={handleInterrupt}
          onDeleteSession={sessionActions.deleteSession}
          onRenameSession={sessionActions.renameSession}
          onPinSession={sessionActions.pinSession}
          onArchiveSession={(sessionId, isArchived) => void sessionActions.archiveSession(sessionId, isArchived)}
          footer={
            <ProfileFooter
              name={userProfile.name}
              email={userProfile.email}
              github={github.status}
              version={userProfile.version}
              updateCount={agentUpdates.updateCount}
              onOpenSettings={() => setSettingsTab("general")}
            />
          }
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <article className={`${isDiffOpen && isDiffExpanded ? "hidden" : "flex"} flex-1 flex-col bg-bg relative overflow-hidden`}>
              {isDraggingFiles && <FileDropOverlay />}
              {notice && <NoticeBanner message={notice} onDismiss={() => setNotice(null)} />}
              {failedTurns[activeSessionId] && (
                <FailedTurnBanner
                  agentName={activeAgent?.name}
                  error={failedTurns[activeSessionId]}
                  isBusy={isSessionBusy(activeSessionId)}
                  onRetry={
                    acp.hasFailedPrompt(activeSessionId)
                      ? () => void acp.retryFailedTurn(activeSessionId, (unsent) => restoreMessage(activeSessionId, unsent.text, unsent.attachments))
                      : undefined
                  }
                  onDismiss={() => clearFailedTurn(activeSessionId)}
                />
              )}
              <AppUpdateNotice
                update={appUpdate.update}
                busyCount={sessions.filter((session) => isSessionBusy(session.id)).length}
                terminalCount={terminals.liveCount}
                isInstalling={appUpdate.isInstalling}
                progress={appUpdate.progress}
                onInstall={() => void appUpdate.install()}
                onLater={appUpdate.dismiss}
              />
              <UpdateNotice
                agents={agentUpdates.unnotified}
                onShow={() => { agentUpdates.acknowledge(); setSettingsTab("agents"); }}
                onDismiss={agentUpdates.acknowledge}
              />
              <SignInLayer
                signIn={signIn}
                agents={agents}
                agentId={activeSession?.profileId ?? (activeRun ? undefined : newSessionAgent?.id)}
                showTerminal={settingsTab === null}
              />
              {installPanelAgent ? <AgentInstallPanel agent={installPanelAgent} /> : null}
              {activeRun ? (
                <CompareRunPanel
                  run={activeRun}
                  rows={runRows}
                  version={runVersion}
                  agentName={(profileId) => agents.find((a) => a.id === profileId)?.name ?? profileId}
                  onOpen={handleSelectSession}
                  onReview={(sessionId) => {
                    handleSelectSession(sessionId);
                    sidePanel.show("diff");
                  }}
                  onChoose={chooseOption}
                  onPick={(winnerId) => compareRun.pick(activeRun, winnerId)}
                />
              ) : activeSession && (currentMessages.length > 0 || isSessionBusy(activeSessionId) || activeSession.historyElsewhere) ? (
                <ChatCanvas
                  conversationId={activeSessionId}
                  messages={currentMessages}
                  agentName={activeAgent?.name}
                  onForkBranch={(messageId) => void forkSession(messageId)}
                  onRewind={(messageId) => { compareRun.dropSignIn(activeSessionId); void rewind(activeSession, messageId); }}
                  header={
                    <div className="space-y-3 rounded-xl border border-border bg-surface-1 px-4 py-3">
                      {activeSession.historyElsewhere && (
                        <HistoryElsewhereNote agentName={activeAgent?.name ?? "the agent"} />
                      )}
                      <WorkspaceSummary
                        name={folderNameOf(workspacePathOf(activeSession))}
                        path={shownFolderPath ?? activeSession.cwd}
                        details={workspaceDetails}
                      />
                    </div>
                  }
                  onChooseOption={(cardId, optionId) => chooseOption(activeSessionId, cardId, optionId)}
                  onAnswerElicitation={(key, answer) => acp.answerElicitation(activeSessionId, key, answer)}
                  onReopenElicitationUrl={(key) => acp.reopenElicitationUrl(activeSessionId, key)}
                  isWorking={isSessionBusy(activeSessionId) && !isAwaitingUser(currentMessages)}
                  failures={acp.failuresOf(activeSessionId)}
                  onStop={() => handleInterrupt(activeSessionId)}
                />
              ) : isNewSessionDraft ? (
                <NewSessionView
                  workspace={activeWorkspace}
                  details={workspaceDetails}
                  agentName={newSessionAgent?.name}
                  unavailableReason={areAgentsLoaded && !agentsInUse.some(isAgentReady) ? noAgentNotice(agentsInUse) : undefined}
                  worktreeBaseBranch={isWorktreeActive ? branchPicker.baseBranch : undefined}
                  sessionList={draftSessionList.sessionList}
                />
              ) : (
                <EmptySessionState />
              )}

              {/* Hidden, not unmounted: a look at a run's panel must not cost the message being written. */}
              <div hidden={Boolean(activeRun)} className="p-4 flex justify-center">
                {activeAgentRemoved ? (
                  <RemovedAgentPanel agentName={activeAgentRemoved} onAdd={() => activeAgent && catalogActions.addAgent(activeAgent.id)} />
                ) : (
                  <ComposerDock
                    controls={compare.isCompare ? {} : composer.controls}
                    isThinking={Boolean(activeSession) && isSessionBusy(activeSessionId)}
                    onStop={activeSession ? () => handleInterrupt(activeSessionId) : undefined}
                    disabled={isComposerDisabled}
                    sendDisabled={isSendBlocked}
                    placeholder={composerPlaceholder({
                      isRunning: isActiveRunning,
                      isCreatingWorktree,
                      isResumable,
                      canStartSession,
                      // Comments held for another session say nothing about whether this one can continue.
                      isSendBlocked: isSendWaiting,
                      isEndedSession: Boolean(activeSession),
                    })}
                    onSendMessage={handleSendMessage}
                    attachAsFiles
                    onAttach={pickFiles}
                    handleRef={composerRef}
                    onTextChange={review.onComposerText}
                    onRestored={review.onComposerRestored}
                    commands={compare.isCompare ? [] : composerCommands}
                    note={composerNote({
                      reviewOwner: review.reviewOwner,
                      compareCount: compare.agentIds.length,
                      agentToInstall: draftNeedsInstall ? draftAgent?.name : undefined,
                      agentToSignIn: draftNeedsSignIn ? draftAgent?.name : undefined,
                      continuesSession: isResumable || Boolean(activeSession),
                      agentLoading: !isActiveRunning && draftAgent && agentCheck.isProbing(draftAgent.id) ? draftAgent.name : undefined,
                    })}
                    contextUsage={isActiveRunning ? acp.info[activeSessionId]?.usage : undefined}
                    mentions={filesFolder ? { root: filesFolder.path, loadFiles: () => shell.loadWorkspaceFiles(filesFolder.path) } : undefined}
                    folder={
                      isNewSessionDraft
                        ? {
                            folders: workspaces,
                            selectedPath: activeWorkspacePath,
                            onSelect: chooseFolder,
                            onOpenFolder: () => void openFolder(),
                            worktree: canUseWorktree
                              ? {
                                  isOn: isWorktreeActive,
                                  onChange: setIsWorktreeOn,
                                  lockedReason: compare.isCompare ? "Each agent runs in its own worktree." : undefined,
                                }
                              : undefined,
                            branch: branchPicker.control,
                          }
                        : undefined
                    }
                    agent={
                      isNewSessionDraft && newSessionAgent && !canCompare
                        ? {
                            options: pickableAgents.map((a) => ({ value: a.id, label: pickerLabelOf(a) })),
                            selected: newSessionAgent.id,
                            onChange: (agentId) => setPickedAgentId(agentId ?? null),
                          }
                        : undefined
                    }
                    agents={
                      isNewSessionDraft && newSessionAgent && canCompare
                        ? {
                            options: agentChoices,
                            selected: compare.agentIds,
                            onChange: compare.toggle,
                            onPick: (agentId) => {
                              compare.reset();
                              setPickedAgentId(agentId);
                            },
                          }
                        : undefined
                    }
                  />
                )}
              </div>

            </article>
            {sidePanel.open === "changes" && filesFolder && isRepository && (
              <ChangesPanel
                key={filesFolder.path}
                rootPath={filesFolder.path}
                rootName={filesFolder.name}
                branch={workspaceDetails?.branch ?? undefined}
                changes={sidePanel.changes.changes}
                version={sidePanel.changes.version}
                onReload={sidePanel.changes.reload}
                onClose={sidePanel.close}
                pullRequests={repoPullRequests}
                onOpenPullRequest={openPullRequest}
                githubProblem={githubProblem}
                onOpenGithubSettings={() => setSettingsTab("general")}
                diffStats={diffStats}
                onOpenDiff={() => sidePanel.show("diff")}
              />
            )}
            {isDiffOpen && filesFolder && (
              <DiffView
                key={`${activeSession?.id ?? "draft"}:${filesFolder.path}`}
                rootPath={filesFolder.path}
                startCommit={startCommit}
                prefersStart={Boolean(activeSession?.compareRunId)}
                review={activeSession ? review.review : undefined}
                addReview={activeSession ? review.addReview : undefined}
                version={sidePanel.changes.version}
                isExpanded={isDiffExpanded}
                onToggleExpanded={() => setExpandedDiffFolder(isDiffExpanded ? null : filesFolder.path)}
                onClose={sidePanel.close}
                onError={reportError}
              />
            )}
            {sidePanel.open === "files" && filesFolder && (
              <FilesPanel
                key={filesFolder.path}
                rootPath={filesFolder.path}
                rootName={filesFolder.name}
                onClose={sidePanel.close}
                onInsertPath={(path) => insertPaths([path])}
                onRevealRoot={() => filesFolder && shell.revealFolder(filesFolder.path)}
              />
            )}
          </div>
          {terminalDrawer.isOpen && filesFolder && (
            <TerminalDrawer
              folderPath={filesFolder.path}
              folderName={filesFolder.name}
              branch={workspaceDetails?.branch ?? undefined}
              terminals={terminals}
              startingFor={terminalDrawer.startingFor}
              onStartShell={terminalDrawer.startShell}
              onHide={terminalDrawer.hide}
            />
          )}
        </div>
      </section>
      <AppSettingsDialog
        isOpen={settingsTab !== null}
        initialTab={settingsTab ?? undefined}
        persisted={{ state, updateState }}
        agents={agents}
        refreshAgents={refreshAgents}
        catalog={agentCatalog}
        actions={catalogActions}
        recentFolders={workspaces}
        onRemoveRecentFolder={removeFolder}
        onRunOnboarding={handleRunOnboarding}
        onClose={() => setSettingsTab(null)}
        github={github}
        agentSignIn={settingsSignIn}
        onOpenUrl={openLink}
      />
    </main>
  );
}
