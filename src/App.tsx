import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { canonicalAgentId, loadTranscript } from "./lib/persistence";
import { PRIVATE_AGENT_ID, PRIVATE_DRAFT_TEXT } from "./lib/private-draft";
import { savedThenLive } from "./lib/agent-tools";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { ChatCanvas } from "./components/ChatCanvas";
import { HistoryElsewhereNote } from "./components/chat/HistoryElsewhereNote";
import { ComposerDock, type ComposerHandle } from "./components/ComposerDock";
import { RemovedAgentPanel } from "./components/RemovedAgentPanel";
import { ActivityPanel } from "./components/activity/ActivityPanel";
import { agentNameOr } from "./lib/agent-name";
import { FilesPanel } from "./components/FilesPanel";
import { ArtifactsPanel } from "./components/artifacts/ArtifactsPanel";
import { ArtifactGallery } from "./components/artifacts/ArtifactGallery";
import { useArtifactComments, useArtifactCommentSweep } from "./hooks/useArtifactComments";
import { canvasBoardsNow } from "./hooks/useCanvas";
import { useArtifacts } from "./hooks/useArtifacts";
import { useVisualSweep } from "./hooks/useVisualSweep";
import { useArtifactOpening } from "./hooks/useArtifactOpening";
import { galleryRows, hasVersion, newestVersion, shownArtifactOf, shownCanvasOf } from "./lib/artifacts";
import { markersOf } from "./lib/file-markers";
import { EmptyFolderState, FileDropOverlay } from "./components/AppPlaceholders";
import { Toast, ToastStack } from "./components/ui/Toast";
import { CompareRunPanel } from "./components/compare/CompareRunPanel";
import { FailedTurnBanner } from "./components/FailedTurnBanner";
import { SignInLayer } from "./components/SignInLayer";
import { RecoveryCodeLayer } from "./components/private/RecoveryCodeLayer";
import { SecretGuardDialog } from "./components/private/SecretGuardDialog";
import { PrivateCreditsOutLayer } from "./components/private/PrivateCreditsOut";
import { PrivateInspector } from "./components/private/PrivateInspector";
import { PrivateLowBalanceRow } from "./components/private/PrivateLowBalanceRow";
import { AgentInstallPanel } from "./components/AgentInstallPanel";
import { installPanelAgentOf } from "./lib/install-panel";
import { NewSessionAbove, NewSessionBelow } from "./components/workspace/NewSessionView";
import { ChangesPanel } from "./components/changes/ChangesPanel";
import { DiffView } from "./components/changes/DiffView";
import { totalsOf } from "./lib/diff-stats";
import { useInspector } from "./hooks/useInspector";
import { useWindowWidth } from "./hooks/useWindowWidth";
import { useNotice } from "./hooks/useNotice";
import { Inspector } from "./components/inspector/Inspector";
import { maxInspectorWidth, offeredTabs } from "./lib/inspector";
import { useReviewComments } from "./hooks/useReviewComments";
import { useReviewWiring } from "./hooks/useReviewWiring";
import type { ReviewSlot } from "./hooks/useReviewMessage";
import { useSecretGuard } from "./hooks/useSecretGuard";
import { useTurnsEnded } from "./hooks/useTurnsEnded";
import { usePullRequest } from "./hooks/usePullRequest";
import { useWorkspacePullRequests } from "./hooks/useWorkspacePullRequests";
import { createdFilesOf } from "./lib/created-files";
import { overviewOf } from "./lib/session-overview";
import { useOverviewCollapse } from "./hooks/useOverviewCollapse";
import { OverviewCard } from "./components/overview/OverviewCard";
import { useAgentWork } from "./hooks/useAgentWork";
import { newestSessionInFolder, pullRequestOfWork, pullRequestOnBranch, sessionPullRequestOf } from "./lib/pull-request-look";
import { currentPlan } from "./lib/plan";
import { useRepoPullRequests } from "./hooks/useRepoPullRequests";
import { useAgentSignIn } from "./hooks/useAgentSignIn";
import { useAgentSignInStatus } from "./hooks/useAgentSignInStatus";
import { useDraftAgentCheck } from "./hooks/useDraftAgentCheck";
import { useSettingsSignIn } from "./hooks/useSettingsSignIn";
import { useLatest } from "./hooks/useLatest";
import { useUnsentMessages } from "./hooks/useUnsentMessages";
import type { QueuedMessage } from "./lib/queued-messages";
import { useQueuedMessages } from "./hooks/useQueuedMessages";
import { QueuedMessages } from "./components/composer/QueuedMessages";
import { attachmentsFor, createSessionWorktree } from "./lib/session-worktree";
import { sweepOrphans } from "./lib/orphan-sweep";
import {
  isWaitingForAnswer,
  newSessionRecord,
  namingFor,
  titlePlaceOf,
  type SessionSpec,
  type StartSessionOptions,
} from "./lib/session-start";
import { isAwaitingUser } from "./lib/acp-elicitation";
import {
  folderNameOf,
  isArchived,
  isListed,
  isAutoName,
  workspacePathOf,
  mostRecentSessionId,
  nextSessionName,
  patchSessionIn,
} from "./lib/session-helpers";
import { useAppearance } from "./hooks/useAppearance";
import { usePersistedState } from "./hooks/usePersistedState";
import { useAgentTasks } from "./hooks/useAgentTasks";
import { useBackgroundTasks } from "./hooks/useBackgroundTasks";
import { useSessionTaskTabs } from "./hooks/useSessionTaskTabs";
import type { TaskTab } from "./hooks/useTaskTabs";
import { TasksPanel } from "./components/tasks/TasksPanel";
import { useTranscripts } from "./hooks/useTranscripts";
import { usePrivateCreditsRefresh } from "./hooks/usePrivateCreditsRefresh";
import { usePrivateTopupRequests } from "./hooks/usePrivateTopupRequests";
import { PrivateTopupRequestCard } from "./components/private/PrivateTopupRequestCard";
import { TopupProgress } from "./components/private/TopupProgress";
import { isTopupActive } from "./lib/private-flow";
import { usePrivateLowBalanceNotice } from "./hooks/usePrivateLowBalanceNotice";
import { usePrivateUsage } from "./hooks/usePrivateUsage";
import { usePrivateVerification } from "./hooks/usePrivateVerification";
import { actionError, lowBalanceNote } from "./lib/private-credits";
import { useAgentProfiles, useSuggestedFolders } from "./hooks/useDiscovery";
import { useAutoInstall } from "./hooks/useAutoInstall";
import { usedAgentIds } from "./lib/agent-catalog";
import { useDraftInstall } from "./hooks/useDraftInstall";
import { useWorkspaceSelection } from "./hooks/useWorkspaceSelection";
import { Onboarding, type OnboardingResult } from "./components/Onboarding";
import { SettingsPage } from "./components/settings/SettingsPage";
import { useSettingsPage } from "./hooks/useSettingsPage";
import { useAgentCatalog } from "./hooks/useAgentCatalog";
import { useAgentCatalogActions } from "./hooks/useAgentCatalogActions";
import { useAutoEnabledAgents } from "./hooks/useAutoEnabledAgents";
import { useShellActions } from "./hooks/useShellActions";
import { useAgentUpdates } from "./hooks/useAgentUpdates";
import { UpdateNotice } from "./components/UpdateNotice";
import { AppUpdateNotice } from "./components/AppUpdateNotice";
import { restartWarning } from "./lib/app-update";
import { useAppUpdate } from "./hooks/useAppUpdate";
import { useAgentTools } from "./hooks/useAgentTools";
import { withLinkChange, workerHandleOf, workerStateOf } from "./lib/workers";
import { useComputerUse } from "./hooks/useComputerUse";
import { isComputerUseCardId } from "./lib/computer-use-card";
import { ComputerUseStatusLine } from "./components/chat/ComputerUseStatusLine";
import { useBrowserAgentTools } from "./hooks/useBrowserAgentTools";
import { useBrowserOpening } from "./hooks/useBrowserOpening";
import { useFileLinkOpening } from "./hooks/useFileLinkOpening";
import { BrowserPanel } from "./components/browser/BrowserPanel";
import { BrowserPermissionLayer } from "./components/browser/BrowserPermissionLayer";
import { useOpenedSessions } from "./hooks/useOpenedSessions";
import { createStartPlaces } from "./lib/start-places";
import { ProfileFooter } from "./components/ProfileFooter";
import { AgentsMenu } from "./components/sidebar/AgentsMenu";
import { useNavigationHistory } from "./hooks/useNavigationHistory";
import { useUserProfile } from "./hooks/useUserProfile";
import { useGithubConnection } from "./hooks/useGithubConnection";
import { usePrivateContinue, usePrivateWiring } from "./hooks/usePrivateWiring";
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
import { ContextPanel } from "./components/context/ContextPanel";
import { compactCommandOf } from "./lib/context-usage";
import type { AcpConfigOption } from "./hooks/useAcpSessions";
import { attentionBody, notifyIfAway } from "./lib/notify";
import { pickFiles } from "./lib/file-picker";
import { useFileDrop } from "./hooks/useFileDrop";
import { isAgentReady, isAgentRunnable, noAgentNotice, resolveDraftAgentId } from "./lib/agent-readiness";
import { isInUse, removedAgentName, removedAgentNameFor } from "./lib/enabled-agents";
import { isSetupOnly } from "./lib/acp-auth";
import { recheckAgents } from "./lib/agent-recheck";
import { useCompareDraft } from "./hooks/useCompareDraft";
import { useCompareRun, useCompareRunRows } from "./hooks/useCompareRun";
import { useCompareModelProbe } from "./hooks/useCompareModelProbe";
import { useDelegation } from "./hooks/useDelegation";
import { useWorkerAutoClose } from "./hooks/useWorkerAutoClose";
import { useWorkerStops } from "./hooks/useWorkerStops";
import { useNow } from "./hooks/useNow";
import { DelegateDialog, type DelegateAgentChoice } from "./components/delegation/DelegateDialog";
import { useDelegateDialog } from "./hooks/useDelegateDialog";
import { delegatedStartOf, delegationChoicesFor as delegationChoicesForOptions } from "./lib/delegation-start";
import { DelegationStatusLine } from "./components/delegation/DelegationStatusLine";
import { DelegatedFromLine } from "./components/delegation/DelegatedFromLine";
import { OpenedByLine } from "./components/delegation/OpenedByLine";
import {
  followUpSummary,
  isOpenLink,
  mentionBlockedReason,
  soleOpenDelegateOf,
  openDelegatesOf,
  startSummary,
  type MentionAgentStatus,
} from "./lib/delegation";
import { compareModelControls } from "./lib/compare-models";
import { lastOfRun, runOf } from "./lib/compare-run";
import { compareAgentOptions } from "./lib/composer-controls";
import { COMPARE_NOTE, DRAFT_COMPARE_HELPER, composerCommandsFor, composerNote, composerPlaceholder, composerStateFor } from "./lib/composer-state";
import {
  NO_CHOICES,
  rememberedChoice,
  withEffortList,
  withPreferred,
  withProbed,
  withReported,
  withRewound,
  type AcpChoices,
  type AgentOptions,
  type ProbedOptions,
} from "./lib/acp-draft";
import type { AgentProfile, ArtifactCard, ArtifactComment, ReviewComment, DelegationLink, Session, SessionWorktree, Settings, WorkerTurnEnd } from "./types";
import { replyBlockedReason } from "./lib/reply-quote";

const NO_FOLDER_NOTICE = "Open a project folder first: choose one from the folder chip by the message box.";

// eslint-disable-next-line no-control-regex -- matching control characters is the point.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export default function App() {
  const { notice, setNotice, offerNotice } = useNotice();
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
  const [isRaisingPrivateCap, setIsRaisingPrivateCap] = useState(false);
  /** Bumped after each of the active agent's turns, so its folder's branch is read again. */
  const [branchCheck, setBranchCheck] = useState(0);
  const [acpChoices, setAcpChoices] = useState<AcpChoices>(NO_CHOICES);
  // The footer's Settings button: focus comes back to it from Settings when what opened Settings is gone.
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsPage = useSettingsPage(settingsButtonRef);
  const [isSidebarHidden, setSidebarHidden] = useState(false);
  // The gallery of every session's artifacts takes the main sheet's place; picking anything in the sidebar leaves it.
  const [isGalleryOpen, setGalleryOpen] = useState(false);
  const windowWidth = useWindowWidth();
  const composerRef = useRef<ComposerHandle>(null);
  // The top bar's Inspector button: focus goes back to it when the inspector closes from its own button.
  const inspectorButtonRef = useRef<HTMLButtonElement>(null);
  // The top bar's ⋯ button: focus goes back to it when the delegate dialog the menu opened closes.
  const moreOptionsButtonRef = useRef<HTMLButtonElement>(null);
  /** The delegation the composer's text asks for, as the mention menu reported it: never on mount. */
  const [delegationMention, setDelegationMention] = useState<{ agentId: string; task: string } | null>(null);
  // Set once useDelegation is built: the engine's turns reach it through this, as it is built before the hook.
  const delegationTurnEndedRef = useRef<(sessionId: string, reason: AttentionReason) => void>(() => {});
  const queueRewoundRef = useRef<(sessionId: string) => void>(() => {});
  const queuePromptStartedRef = useRef<(sessionId: string) => void>(() => {});
  const queueAgentEndedRef = useRef<(sessionId: string) => void>(() => {});
  const queueTurnSettledRef = useRef<(sessionId: string, end: { how: WorkerTurnEnd }) => void>(() => {});
  const delegationTurnSettledRef = useRef<(sessionId: string, end: { how: WorkerTurnEnd; reason?: string }) => void>(() => {});
  // Set once useDelegation is built: the engine's retries read why the pair blocks them, as it is built before the hook.
  const delegationBlockedRef = useRef<(sessionId: string) => string | null>(() => null);

  const reportError = useCallback((message: string) => setNotice(message), [setNotice]);
  const { state, isLoaded, updateState, getState, saveNow } = usePersistedState(reportError);
  useAppearance(state.settings.appearance, isLoaded, reportError);
  const { transcripts, transcriptStatus, ensureLoaded, updateMessages, saveSoon, removeTranscript, flush: flushTranscripts } = useTranscripts(reportError);
  const updateSessionUsage = useCallback(
    (sessionId: string, privateUsage: NonNullable<Session["privateUsage"]>) => {
      updateState((prev) => patchSessionIn(prev, sessionId, { privateUsage }));
    },
    [updateState],
  );
  const privateUsage = usePrivateUsage({ sessions: state.sessions, updateSession: updateSessionUsage });
  const privateVerification = usePrivateVerification({
    updateMessages,
    saveSoon,
    isKnownSession: (id) => state.sessions.some((session) => session.id === id),
    onCheck: privateUsage.refresh,
  });
  const {
    agents,
    isLoaded: areAgentsLoaded,
    loadError: agentsError,
    refresh: refreshAgents,
    reload: reloadAgents,
  } = useAgentProfiles(reportError);
  const agentCatalog = useAgentCatalog();
  const shell = useShellActions(setNotice);
  // An update restarts Zorvo without closing the page, so its exit handlers never write what is still waiting for a timer.
  const writePendingBeforeRestart = useCallback(
    () => Promise.all([saveNow(), flushTranscripts()]).then(() => undefined),
    [saveNow, flushTranscripts],
  );
  const appUpdate = useAppUpdate(reportError, writePendingBeforeRestart);
  // macOS applies a newly allowed Screen Recording permission only after Zorvo restarts.
  const restartZorvo = useCallback(() => {
    writePendingBeforeRestart().then(
      () => invoke("app_restart").catch(() => reportError("Zorvo could not restart. Quit and open it again.")),
      () => reportError("Zorvo could not save your work, so it did not restart."),
    );
  }, [writePendingBeforeRestart, reportError]);
  const computerUseSetting = useMemo(
    () => ({ onRestart: restartZorvo, onError: reportError }),
    [restartZorvo, reportError],
  );
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
  // After an update of Zorvo, the npm packages of the agents you have used are installed without a click.
  useAutoInstall({
    agentsInUse,
    usedIds: usedAgentIds(state.settings, state.sessions),
    isReady: isLoaded && areAgentsLoaded && state.settings.onboardingCompleted,
  });
  // A saved session of a removed agent stays readable; once it stops, its composer offers to add the agent again.
  const activeAgentRemoved = removedAgentNameFor(activeSession, agents, state.settings);
  // Hidden, not unmounted: a look at either must not cost the message being written.
  const isComposerHidden = Boolean(activeRun) || activeAgentRemoved !== null;
  // The draft composer's places between its chips and its card, where the install and sign-in panels go, in that order.
  const [draftInstallSlotElement, setDraftInstallSlotElement] = useState<HTMLDivElement | null>(null);
  const [draftSignInSlotElement, setDraftSignInSlotElement] = useState<HTMLDivElement | null>(null);
  const draftBlockerSlots = useMemo(() => ({ install: setDraftInstallSlotElement, signIn: setDraftSignInSlotElement }), []);
  // The draft's folder and branch chips are the composer's, drawn beside the heading.
  // An agent not installed yet is offered too: picking it shows its Install panel.
  const pickableAgents = agentsInUse;
  const defaultAgentId = resolveDraftAgentId(agentsInUse, state.settings.defaultAgentId, pickableAgents);
  const primaryAgentId = pickableAgents.find((a) => a.id === pickedAgentId)?.id ?? defaultAgentId;
  // No session is selected and no run is open: the window shows a new one, not started until its first message.
  const isNewSessionDraft = !activeSession && !activeRun;
  // The folder a draft starts in; a draft with no folder open asks for one instead.
  const draftWorkspace = isNewSessionDraft ? activeWorkspace : undefined;
  // The main area's column: each draft and session is shown from its top, not where the last one was scrolled to.
  const mainColumnRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (mainColumnRef.current) mainColumnRef.current.scrollTop = 0;
  }, [activeSessionId, activeRun?.id, draftWorkspace?.path]);
  // Only a draft uses the slot: its composer is never hidden, so a panel there is never hidden with it.
  const draftInstallSlot = isNewSessionDraft ? draftInstallSlotElement : null;
  const draftSignInSlot = isNewSessionDraft ? draftSignInSlotElement : null;
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
  // The one agent that runs privately, when it is in use: turning Private on picks it alone.
  const privateAgentId = pickableAgents.find((agent) => canonicalAgentId(agent.id) === PRIVATE_AGENT_ID)?.id;
  const {
    credits: privateCredits,
    recoveryDialog,
    draft: privateDraft,
    isPrivateLaunch,
    onCreditsOut,
    refusesSend,
  } = usePrivateWiring({
    isTopupShown: settingsPage.section === "private",
    setNotice,
    offerNotice,
    draftAgentIds: isNewSessionDraft && newSessionAgent ? (compare.isCompare ? compare.agentIds : [newSessionAgent.id]) : [],
    draftAgentName: isNewSessionDraft ? newSessionAgent?.name : undefined,
    paymentSource: state.settings.paymentSource ?? "credits",
    activeSession,
    canPickPrivateAgent: privateAgentId !== undefined,
    onTurnOnPrivate: () => {
      if (privateAgentId === undefined) return;
      compare.reset();
      setPickedAgentId(privateAgentId);
    },
  });
  const topupRequests = usePrivateTopupRequests();
  const [chatTopupSession, setChatTopupSession] = useState<string | null>(null);
  const [isAnsweringTopup, setIsAnsweringTopup] = useState(false);
  /** The user's answer to an agent's ask; an approval starts the existing checkout flow. */
  const answerTopupRequest = useCallback(
    async (sessionId: string, requestId: string, approve: boolean) => {
      const request = topupRequests.requests[sessionId];
      if (!request || request.requestId !== requestId || isAnsweringTopup) return;
      setIsAnsweringTopup(true);
      const ok = await topupRequests.answer(sessionId, requestId, approve);
      setIsAnsweringTopup(false);
      if (!ok) {
        setNotice("That top-up request is no longer waiting.", "warning");
        return;
      }
      if (approve) {
        setChatTopupSession(sessionId);
        void privateCredits.buy(request.usd);
      }
    },
    [isAnsweringTopup, privateCredits, setNotice, topupRequests],
  );
  const isPrivateSessionId = useCallback(
    (sessionId: string) => sessions.some((session) => session.id === sessionId && session.privateMode !== undefined),
    [sessions],
  );
  // A private turn's model calls change the balance: read it again, at most once a minute across sessions.
  const refreshPrivateCredits = usePrivateCreditsRefresh(privateCredits.refresh, isPrivateSessionId);
  const verifyPrivateTurn = privateVerification.verifyTurn;
  const onPrivateTurnEnd = useCallback(
    (sessionId: string) => {
      verifyPrivateTurn(sessionId);
      refreshPrivateCredits(sessionId);
    },
    [verifyPrivateTurn, refreshPrivateCredits],
  );
  // A private session's low-balance row needs its model's price, so the catalog loads when it opens.
  const activePrivateModelId = activeSession?.privateMode?.modelId;
  const privateModels = privateCredits.models;
  const loadPrivateCatalog = privateCredits.loadCatalog;
  useEffect(() => {
    if (activePrivateModelId !== undefined && privateModels === null) {
      void loadPrivateCatalog();
    }
  }, [activePrivateModelId, privateModels, loadPrivateCatalog]);
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
    // setNotice keeps one identity, so this still runs once, on load.
  }, [setNotice]);

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

  const updateLink = useCallback(
    (sessionId: string, change: (link: DelegationLink) => DelegationLink) =>
      updateState((prev) => withLinkChange(prev, sessionId, change)),
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
  const updateArtifactComments = useCallback(
    (sessionId: string, change: (prev: ArtifactComment[]) => ArtifactComment[]) =>
      updateState((prev) => ({
        ...prev,
        sessions: prev.sessions.map((s) => {
          if (s.id !== sessionId) return s;
          const current = s.artifactComments ?? [];
          const next = change(current);
          return next === current ? s : { ...s, artifactComments: next };
        }),
      })),
    [updateState],
  );
  const reviewComments = useReviewComments(activeSession?.id, activeSession?.reviewComments, updateReviewComments);
  const unsentCommentCount = reviewComments.comments.filter((comment) => comment.sentAt === undefined).length;

  const rememberAgentOptions = (profileId: string, options: Partial<AgentOptions>) =>
    updateState((prev) => ({
      ...prev,
      agentOptions: { ...prev.agentOptions, [profileId]: withReported(prev.agentOptions?.[profileId], options) },
    }));

  /** Keeps a model or effort pick (as the agent settled it), so the agent's next session starts with it too. */
  const rememberPick = (profileId: string, configId: string, value: string, reported?: AcpConfigOption[]) => {
    // A private session's or draft's options are its TEE model's: they never become the agent's for ordinary drafts.
    if (isPrivateLaunch) return;
    const preferredConfig = rememberedChoice(state.agentOptions?.[profileId], configId, value, reported);
    if (!preferredConfig) return;
    // The lists on offer follow too (an effort list depends on its model), so the next draft offers the same.
    rememberAgentOptions(profileId, { preferredConfig, ...(reported?.length ? { configOptions: reported } : {}) });
  };

  /** Keeps a model pick among an agent's `models`, so the agent's next session starts with it too. */
  const rememberModelPick = (profileId: string, preferredModelId: string) => {
    if (!isPrivateLaunch) rememberAgentOptions(profileId, { preferredModelId });
  };

  const isComposerHiddenRef = useLatest(isComposerHidden);
  /** Whatever its status: a composer on its way to hiding would carry a message into the next session on screen. */
  const isAgentRemovedFor = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    return removedAgentName(agents.find((agent) => agent.id === session?.profileId), state.settings) !== null;
  };
  // A rewound message replaces the box, in the session the user is rewinding.
  const restoreMessage = (sessionId: string, text: string, attachments?: readonly string[]) => {
    setActiveSessionId(sessionId);
    // The message waits for the composer to show, where it can take the focus.
    if (composerRef.current && !isComposerHiddenRef.current && !isAgentRemovedFor(sessionId)) composerRef.current.restore(text, attachments);
    else pendingRestoreRef.current = { text, attachments, sessionId };
  };
  // A message that did not reach the agent: the user may have opened another session meanwhile, so it goes
  // back into the composer of the session it was written for, after what is typed there, and waits for
  // that session to be on screen rather than pulling the user there, and for any other session's comments to leave the composer.
  const isMessageHeldFor = (sessionId: string) => review.isHeldFor(sessionId) || isAgentRemovedFor(sessionId);
  const { giveBack: giveBackMessage } = useUnsentMessages({
    composerRef,
    activeSessionId,
    sessionIds: sessions.map((s) => s.id),
    isHeldFor: isMessageHeldFor,
  });
  /** Puts a held message's review comments back after its text returns, so Send still marks them. */
  const rearmReviewRef = useRef<((slot: ReviewSlot) => void) | null>(null);
  /** Edit message: back into the composer of the session it was written for, never another one's. */
  const editSecretMessage = useCallback(
    (
      sessionId: string | undefined,
      message: { text: string; attachments?: readonly string[] },
      reviewSlot?: ReviewSlot,
    ) => {
      if (sessionId === undefined) {
        // A draft has no review comments: restore into the draft's composer only.
        composerRef.current?.restore(message.text, message.attachments);
        return;
      }
      giveBackMessage(sessionId, message.text, message.attachments ?? []);
      if (reviewSlot?.sessionId === sessionId) rearmReviewRef.current?.(reviewSlot);
      if (sessionId !== activeSessionId) {
        setNotice("Your message is back in that session's composer in the main window.");
      }
    },
    [activeSessionId, giveBackMessage, setNotice],
  );
  const secretGuard = useSecretGuard({
    isEnabled: isPrivateLaunch && state.settings.secretGuard !== false,
    root: activeSession?.cwd ?? activeWorkspacePath,
    agentName: activeAgent?.name ?? newSessionAgent?.name ?? "The agent",
    onEdit: editSecretMessage,
  });
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
    onRestore: giveBackMessage,
    isHeldFor: isMessageHeldFor,
  });

  const rememberProbed = (profileId: string, probed: ProbedOptions) =>
    updateState((prev) => ({
      ...prev,
      // A probe's lists are true for the model it ran, even where a session's report wins the shown ones.
      agentOptions: { ...prev.agentOptions, [profileId]: withEffortList(withProbed(prev.agentOptions?.[profileId], probed), probed) },
    }));
  // A compare draft's model chips: an agent whose models are unknown is asked only when its chip opens.
  const compareAgentIdsRef = useLatest(compare.agentIds);
  const compareModelProbe = useCompareModelProbe({
    cwd: shownFolderPath ?? undefined,
    agentOptions: state.agentOptions,
    onProbed: rememberProbed,
    onSignedIn: signInStatus.markSignedIn,
    onNeedsSignIn: (profileId) => {
      // Marked as needing a sign-in, it can no longer be ticked, so it leaves the run; say so only if it was in it.
      const wasInRun = compareAgentIdsRef.current.includes(profileId);
      signInStatus.markNeeded(profileId);
      if (wasInRun) {
        const name = agents.find((a) => a.id === profileId)?.name ?? profileId;
        setNotice(`${name} needs a sign-in, so it left the run. Pick it alone to sign in.`);
      }
    },
  });
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
    agent: isActiveRunning || !isDraftAgentReady || compare.isCompare || isPrivateLaunch ? undefined : draftAgent,
    cwd: shownFolderPath ?? undefined,
    agentOptions: state.agentOptions,
    rememberProbed,
    auth: signIn.auth,
    onSignedIn: signInStatus.markSignedIn,
    onUnconfirmed: signInStatus.markUnconfirmed,
  });
  // Its sign-in panel is open (and not yet done): a message would only be refused.
  const draftNeedsSignIn =
    !isPrivateLaunch &&
    draftAgent !== undefined &&
    signIn.auth.authRequest?.profileId === draftAgent.id &&
    signIn.auth.authRequest.status !== "signed-in";

  const engineDeps = { sessions, agents, updateMessages, patchSession, reportError };
  const acp = useAcpEngine({
    ...engineDeps,
    transcripts,
    saveSoon,
    rememberOptions: rememberAgentOptions,
    onAttention: (id, reason) => {
      notifyAttention(id, reason);
      delegationTurnEndedRef.current(id, reason);
      if (reason !== "needs-answer") setRunVersion((n) => n + 1);
    },
    onTurnSettled: (id, end) => {
      // The user's queued message goes first: the worker reports that wait for a free coordinator are drained from an effect.
      queueTurnSettledRef.current(id, end);
      delegationTurnSettledRef.current(id, end);
    },
    onAuthRequired: (session, methods, unsent) => {
      if (!compareRun.isInRun(session.id)) {
        signIn.handBack(session, methods, unsent);
        return;
      }
      // Several agents of a run can be refused at once and its panel hides the composer: each waits on its row.
      signInStatus.markNeeded(session.profileId);
      compareRun.keepSignIn(session.id, { methods, unsent });
    },
    onAgentEnded: (id) => queueAgentEndedRef.current(id),
    onPromptStarted: (id) => queuePromptStartedRef.current(id),
    onTurnFailed: (sessionId, error) =>
      error ? setFailedTurns((prev) => ({ ...prev, [sessionId]: error })) : clearFailedTurn(sessionId),
    // Read when a retry runs, long after the render that built the engine: the latest hook decides.
    promptBlockedReason: (sessionId) => delegationBlockedRef.current(sessionId),
    // An own-key session's refusal is about the user's NEAR AI key, not about Zorvo's balance.
    onPrivateCreditsOut: (sessionId, reason) =>
      onCreditsOut(sessionId, reason, sessions.find((s) => s.id === sessionId)?.privateMode?.ownKey === true),
    onPrivateTurnEnd,
    giveBack: (sessionId, message) => giveBackMessage(sessionId, message.text, message.attachments),
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
    onRewound: (sessionId) => queueRewoundRef.current(sessionId),
    agents,
    transcripts,
    acp,
    patchSession,
    updateMessages,
    onRestore: restoreMessage,
    onGiveBack: giveBackMessage,
    onNotice: setNotice,
  });

  const isSessionBusy = (sessionId: string) => acp.isBusy(sessionId) || isRestarting(sessionId);

  // What a new or resumed session starts with: the picks made for it, else the
  // model picked last; a rewound session's fresh agent, the model and effort it
  // ran with, checked against its own lists (another model offers other efforts).
  const rewound = activeSession && isResumable ? rewoundOptionsOf(activeSession.id) : undefined;
  const agentOptions = withRewound(state.agentOptions, draftAgent?.id, rewound);
  const startChoices = draftAgent ? withPreferred(acpChoices, agentOptions?.[draftAgent.id]) : acpChoices;

  /** Nothing goes into a message that is not on screen: not behind a run's panel, nor behind Settings. */
  const insertPaths = (paths: string[]) => {
    if (!isComposerHidden && settingsPage.section === null) composerRef.current?.insertPaths(paths);
  };

  /** Dropped files are added to the message; a name with control characters is left out. */
  const handleDroppedFiles = (dropped: string[]) => {
    const paths = dropped.filter((path) => !CONTROL_CHARACTER.test(path));
    if (paths.length < dropped.length) {
      setNotice("Left out a dropped file whose name has control characters.", "warning");
    }
    if (paths.length === 0) return;
    insertPaths(paths);
  };
  const isDraggingFiles = useFileDrop(handleDroppedFiles, reportError);

  const turnsEnded = useTurnsEnded(Boolean(activeSessionId) && isSessionBusy(activeSessionId));
  // The pages each session's agent showed; the backend owns them and says when they change.
  const artifacts = useArtifacts(useMemo(() => sessions.map((session) => session.id), [sessions]));
  const sessionArtifacts = useMemo(() => (activeSession ? artifacts.bySession.get(activeSession.id) ?? [] : []), [artifacts.bySession, activeSession]);
  const sessionCanvases = useMemo(
    () => (activeSession ? artifacts.canvasesBySession.get(activeSession.id) ?? [] : []),
    [artifacts.canvasesBySession, activeSession],
  );
  // The files the agent created in this session, listed in the Artifacts tab under its pages.
  const activeTranscript = activeSessionId ? transcripts[activeSessionId] : undefined;
  const activeCwd = activeSession?.cwd;
  const createdFiles = useMemo(() => createdFilesOf(activeTranscript ?? [], activeCwd), [activeTranscript, activeCwd]);
  const backgroundTasks = useBackgroundTasks({
    sessions,
    transcripts,
    isBusy: acp.isBusy,
    busySince: acp.busySinceOf,
    needsApproval: (id) => isAwaitingUser(transcripts[id] ?? []),
    portsFor: activeSessionId ?? null,
    // Declared further down and only ever called from a click.
    stopAgent: (id) => handleInterrupt(id),
    onError: reportError,
  });
  const overviewCollapse = useOverviewCollapse();
  const taskTabs = useSessionTaskTabs({ sessionId: activeSessionId ?? null, transcripts, tasks: backgroundTasks.tasks });
  const activeInfo = activeSession ? acp.info[activeSession.id] : undefined;
  const agentTasks = useAgentTasks({
    sessionId: activeSession?.id ?? null,
    agentId: activeSession?.profileId,
    acpSessionId: activeSession?.acpSessionId,
    isRunning: activeSession !== undefined && activeSession.status !== "terminated",
    messages: activeTranscript ?? [],
    turnKey: activeInfo?.turnsEnded ?? 0,
  });
  const inspectorTabs = offeredTabs({
    hasFolder: Boolean(filesFolder),
    isRepository,
    hasSession: Boolean(activeSession),
    isPrivate: Boolean(activeSession?.privateMode),
    hasTaskTabs: taskTabs.tabs.length > 0,
    hasUsage: Boolean(activeInfo?.usage),
  });
  const inspector = useInspector(filesFolder?.path, isRepository, turnsEnded, reportError, {
    isSidebarShown: !isSidebarHidden,
    offered: inspectorTabs,
    // What is on screen: the full review takes the chat's place only in the view it opened in.
    view: activeSession ? activeSession.id : activeRun ? `run:${activeRun.id}` : `draft:${filesFolder?.path ?? ""}`,
    onCrowded: () => setSidebarHidden(true),
    // The Terminal tab starts the folder's first shell in the click that shows it.
    onShow: (tab) => {
      if (tab === "terminal" && filesFolder) terminalDrawer.ensureShell(filesFolder.path);
    },
  });
  const openArtifact = useArtifactOpening({
    activeSessionId: activeSession?.id ?? null,
    viewed: inspector.viewedArtifact,
    showTab: () => inspector.show("artifacts"),
    view: inspector.viewArtifact,
  });
  const onArtifactShown = openArtifact;
  useBrowserOpening({ sessionId: activeSession?.id ?? null, show: () => inspector.show("browser"), onError: reportError, onArtifactShown });
  useFileLinkOpening({
    folder: filesFolder?.path,
    viewFile: (relative) => {
      inspector.viewFile(relative);
      inspector.show("files");
    },
    onError: reportError,
  });
  const gallery = useMemo(
    () =>
      galleryRows(sessions, artifacts.bySession, (profileId) => agentNameOr(agents.find((agent) => agent.id === profileId)), artifacts.canvasesBySession),
    [sessions, artifacts.bySession, artifacts.canvasesBySession, agents],
  );
  // The last artifact may go while the gallery is open: then there is nothing to show, and the chat is back.
  const isGalleryShown = isGalleryOpen && gallery.length > 0;
  const openFromGallery = (sessionId: string, artifactId: string) => {
    handleSelectSession(sessionId);
    // For the session about to show, whose id is its view: the one on screen now may be another.
    inspector.viewArtifact({ artifactId, version: null }, sessionId);
    inspector.show("artifacts");
  };
  const openCanvasFromGallery = (sessionId: string, canvasKey: string) => {
    handleSelectSession(sessionId);
    inspector.viewArtifact({ canvasKey }, sessionId);
    inspector.show("artifacts");
  };
  // Artifact ids and canvas keys never look alike, so one set tells a card whether its output is still listed.
  const artifactIds = useMemo(
    () => new Set([...sessionArtifacts.map((artifact) => artifact.id), ...sessionCanvases.map((canvas) => canvas.key)]),
    [sessionArtifacts, sessionCanvases],
  );
  /** A chat card's Open: the version it marks, in the Artifacts tab (the newest is followed, not pinned), or the canvas. */
  const openArtifactCard = (card: ArtifactCard) => {
    if (card.kind === "canvas") {
      if (!sessionCanvases.some((canvas) => canvas.key === card.canvasKey)) return;
      inspector.viewArtifact({ canvasKey: card.canvasKey });
      inspector.show("artifacts");
      return;
    }
    const artifact = sessionArtifacts.find((candidate) => candidate.id === card.artifactId);
    if (!artifact) return;
    inspector.viewArtifact({ artifactId: card.artifactId, version: card.version === newestVersion(artifact) ? null : card.version });
    inspector.show("artifacts");
  };
  // Memoized: the stats object only changes when they are read again.
  const fileMarkers = useMemo(() => markersOf(inspector.headStats, inspector.filesPrefix), [inspector.headStats, inspector.filesPrefix]);
  // A tab that no longer applies (another folder, a draft) does not show.
  const inspectorTab = inspector.tab && inspectorTabs.includes(inspector.tab) ? inspector.tab : null;
  // The open artifact's page takes the chat's place: only on the Artifacts tab of a session that still has one.
  const isArtifactExpanded = inspector.isArtifactExpanded && inspectorTab === "artifacts" && sessionArtifacts.length + sessionCanvases.length > 0;
  // The artifact page on screen, for its comments: the Artifacts tab's viewer shows it, expanded or not.
  const shownArtifact = inspectorTab === "artifacts" ? shownArtifactOf(sessionArtifacts, inspector.viewedArtifact, createdFiles.length + sessionCanvases.length) : undefined;
  const viewedVersion = inspector.viewedArtifact?.artifactId === shownArtifact?.id ? inspector.viewedArtifact?.version : null;
  const shownVersion = shownArtifact ? (viewedVersion ?? newestVersion(shownArtifact)) : 0;
  const shownPage =
    activeSession && shownArtifact && hasVersion(shownArtifact, shownVersion)
      ? { sessionId: activeSession.id, artifactId: shownArtifact.id, version: shownVersion }
      : null;
  // The canvas on screen, for its comments, chosen as the Artifacts tab's viewer chooses it.
  const shownCanvasEntry =
    inspectorTab === "artifacts" && !shownArtifact
      ? shownCanvasOf(sessionCanvases, inspector.viewedArtifact, sessionArtifacts.length + createdFiles.length)
      : undefined;
  const shownCanvas = useMemo(
    () => {
      if (!activeSession || !shownCanvasEntry) return null;
      const { key } = shownCanvasEntry;
      const sessionId = activeSession.id;
      return { sessionId, key, boardsNow: () => canvasBoardsNow(sessionId, key) };
    },
    [activeSession, shownCanvasEntry],
  );
  // The review wiring is built further down; its `forget` reaches the comments through this ref.
  const forgetReviewRef = useRef<((ids: readonly string[]) => void) | null>(null);
  const forgetInMessage = useCallback((ids: readonly string[]) => forgetReviewRef.current?.(ids), []);
  const artifactComments = useArtifactComments({
    sessionId: activeSession?.id,
    comments: activeSession?.artifactComments,
    update: updateArtifactComments,
    shownPage,
    shownCanvas,
    forget: forgetInMessage,
    onError: reportError,
  });
  useAgentWork(sessions, transcripts, patchSession);
  useVisualSweep(activeSessionId, activeSessionId ? (transcripts[activeSessionId] ?? null) : null);
  useArtifactCommentSweep(sessions, artifacts.bySession, artifacts.canvasesBySession, artifacts.readSessions, updateArtifactComments, forgetInMessage);
  /** Shows a subagent's or a shell command's task in the inspector, beside its session's chat. */
  const openTask = (sessionId: string, tab: TaskTab) => {
    taskTabs.open(sessionId, tab);
    inspector.show("tasks");
  };
  const sessionShellTasks = useMemo(
    () => backgroundTasks.tasks.filter((task) => task.kind === "shell" && task.sessionId === activeSessionId),
    [backgroundTasks.tasks, activeSessionId],
  );
  const diffStats = inspector.headStats ? totalsOf(inspector.headStats) : undefined;
  // The commit this session's worktree began at: the diff can compare with it, and the chip stays for it.
  const startCommit = activeSession?.worktree?.startCommit;
  // An activity entry's message to bring into view.
  const [chatJump, setChatJump] = useState<{ messageId: string; nonce: number } | null>(null);
  // The diff view shows beside the chat, or in its place once expanded.
  const isDiffOpen = inspector.isDiffOpen && Boolean(filesFolder) && isRepository;
  // Every session folder's pull requests, one gh call per folder, for the sidebar and the top bar.
  const listedFolders = useMemo(
    () => [...new Set(sessions.filter((session) => !isArchived(session)).map(workspacePathOf))],
    [sessions],
  );
  const busyFolders = sessions.filter((session) => isSessionBusy(session.id)).map(workspacePathOf);
  const folderPullRequests = useWorkspacePullRequests(listedFolders, github.status?.state === "signed-in", busyFolders, {
    liveFolder: activeSession ? workspacePathOf(activeSession) : undefined,
  });
  const newestInFolder = useMemo(() => newestSessionInFolder(sessions), [sessions]);
  const pullRequestOf = useCallback(
    (session: Session) => {
      const folder = folderPullRequests.get(workspacePathOf(session));
      return folder ? sessionPullRequestOf(session, folder, newestInFolder) : null;
    },
    [folderPullRequests, newestInFolder],
  );
  // The top bar reads the same list; its own call is only for a branch outside the 100 newest.
  const shownFolder = activeSession ? folderPullRequests.get(workspacePathOf(activeSession)) : undefined;
  // A session in the folder's own checkout first shows the pull request its agent made, often from a worktree of its own.
  const workPullRequest =
    shownFolder && activeSession && !activeSession.worktree ? pullRequestOfWork(shownFolder, activeSession.agentWork) : null;
  const listedPullRequest =
    workPullRequest ?? (shownFolder ? pullRequestOnBranch(shownFolder, workspaceDetails?.branch ?? null) : null);
  const ownPullRequest = usePullRequest(
    isRepository && !listedPullRequest ? shownFolderPath : undefined,
    workspaceDetails?.branch ?? undefined,
    turnsEnded,
  );
  const pullRequest = listedPullRequest ?? ownPullRequest;
  // Read only while the Changes panel shows them.
  const repoPullRequests = useRepoPullRequests(
    inspectorTab === "changes" ? filesFolder?.path : undefined,
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
  // The tools Zorvo gives agents (main window only). Its helpers are bound late: they are
  // defined further down and only called when a tool call or an answer arrives.
  // The independent sessions an agent opens through the tools. `startSession` is defined
  // further down and only called when a call is allowed.
  const [startPlaces] = useState(createStartPlaces);
  const openedSessions = useOpenedSessions({
    sessions,
    agents: agentsInUse,
    isBusy: (sessionId) => isSessionBusy(sessionId),
    isWaiting: (sessionId) => isSessionWaiting(sessionId),
    places: startPlaces,
    startSession: (spec, first, options) => startSession(spec, first, options),
  });
  const readMessages = async (sessionId: string) => {
    const live = transcripts[sessionId] ?? [];
    if (transcriptStatus[sessionId] === "ready") return live;
    if (transcriptStatus[sessionId] === "failed") throw new Error("unreadable");
    // Not opened in this run: read what was saved, then what arrived since.
    return savedThenLive(await loadTranscript(sessionId), live);
  };
  const agentTools = useAgentTools({
    sessions,
    // Only the agents the user has in use, as the @ list and the dialog offer: an agent
    // taken out of use must not be listed, or started, by another agent.
    agents: agentsInUse,
    statusOf: (agentId) => {
      const agent = agentsInUse.find((candidate) => candidate.id === agentId);
      return agent === undefined ? "not-installed" : delegationStatusOf(agent);
    },
    workersOf: (sessionId) =>
      openDelegatesOf(sessionId, sessions).flatMap((worker) => {
        const link = worker.delegatedFrom;
        const handle = workerHandleOf(worker);
        if (link === undefined || link === null || handle === undefined) return [];
        return [
          {
            handle,
            agent: worker.profileId,
            title: worker.name,
            state:
              workerStateOf({ link, isBusy: isSessionBusy(worker.id), isWaiting: isSessionWaiting(worker.id) }) ?? "idle",
            outcome: link.outcome?.result ?? null,
          },
        ];
      }),
    startWorker: (coordinatorId, input) => delegation.startWorker(coordinatorId, input),
    sendToWorker: (coordinatorId, workerId, task) => delegation.sendToWorker(coordinatorId, workerId, task),
    recordDone: (workerId, done) => delegation.recordDone(workerId, done),
    workspaces,
    openSession: openedSessions.open,
    openedOf: openedSessions.openedOf,
    updateMessages,
    flushUpdates: () => acp.flushQueued(),
    onAttention: (sessionId, reason) => notifyAttention(sessionId, reason),
    onNotice: (message) => setNotice(message),
    onArtifactShown,
    messagesOf: readMessages,
    stateOf: (sessionId) =>
      isSessionWaiting(sessionId) ? "needs-answer" : isSessionBusy(sessionId) ? "working" : "idle",
    stopTurn: (sessionId) => handleInterrupt(sessionId),
  });
  const computerUse = useComputerUse({
    agentNameOf: (sessionId) => {
      const profileId = sessionById(sessionId)?.profileId;
      return agents.find((agent) => agent.id === profileId)?.name ?? "The agent";
    },
    updateMessages,
    onAttention: (sessionId, reason) => notifyAttention(sessionId, reason),
    onNotice: (message) => setNotice(message),
  });
  const isSessionWaiting = (sessionId: string) =>
    browserAgentTools.isWaiting(sessionId) ||
    agentTools.isWaiting(sessionId) ||
    computerUse.isWaiting(sessionId) ||
    isWaitingForAnswer(sessionById(sessionId), transcripts[sessionId] ?? [], () => isSessionBusy(sessionId));
  const browserAgentTools = useBrowserAgentTools({ sessions, agents: agentsInUse, onAttention: (sessionId, reason) => notifyAttention(sessionId, reason), onError: reportError });

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
    void acp.start(session, first, options?.choices ?? startChoices).then((isTaken) => {
      if (!isTaken && first) giveBackMessage(session.id, first.text, first.attachments);
    });
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
      setNotice(NO_FOLDER_NOTICE, "warning");
      return;
    }
    if (!newSessionAgent) {
      setNotice(noAgentNotice(agentsInUse), "warning");
      return;
    }
    rememberFolder(activeWorkspace);
    // Read now: the draft, and its Private chip with it, is gone once the session starts.
    const { privateMode } = privateDraft;
    const sessionPrivateMode = privateMode
      ? { ...privateMode, ...(state.settings.paymentSource === "ownKey" ? { ownKey: true } : {}) }
      : undefined;
    const naming = first
      ? namingFor(first, { agentName: newSessionAgent.name, folderName: activeWorkspace.name })
      : { name: nextSessionName(sessions) };
    const { name } = naming;
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
    startSession({ agent: newSessionAgent, cwd, ...naming, worktree, privateMode: sessionPrivateMode }, message);
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
    setGalleryOpen(false);
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

  const { creditsOutReason, creditsOutNote, continueAgents, continueWithAgent } = usePrivateContinue({
    credits: privateCredits,
    activeSession,
    agents,
    agentsInUse,
    transcripts,
    agentOptions: state.agentOptions,
    openNewSession,
    forkSession,
  });

  const handleRaisePrivateCap = async () => {
    const session = activeSession;
    const cap = session?.privateMode?.sessionCap;
    if (!session?.privateMode || cap === undefined || isRaisingPrivateCap) return;
    setIsRaisingPrivateCap(true);
    try {
      const raised = await invoke<number>("private_raise_session_cap", {
        sessionId: session.id,
        credits: cap * 2,
      });
      patchSession(session.id, {
        privateMode: { ...session.privateMode, sessionCap: raised },
      });
      privateCredits.clearCreditsOut(session.id);
    } catch (error) {
      setNotice(actionError("raise", String(error)), "warning");
    } finally {
      setIsRaisingPrivateCap(false);
    }
  };

  /** Starts a fresh private session from this one, with no cap. */
  const handleNewPrivateSession = () => {
    if (!activeSession?.privateMode) return;
    const last = (transcripts[activeSession.id] ?? []).at(-1);
    if (last) {
      void forkSession(last.id, { uncappedPrivate: true });
      return;
    }
    const agent = agents.find((candidate) => candidate.id === activeSession.profileId);
    if (!agent) return;
    startSession({
      agent,
      cwd: activeSession.cwd,
      name: nextSessionName(sessions),
      privateMode: { modelId: activeSession.privateMode.modelId },
    });
  };

  /**
   * Switches this Mac to Zorvo credits and starts a fresh credits session from this one: the running
   * agent holds an own-key proxy token, so only a new process can pay with credits.
   */
  const handleSwitchToCredits = () => {
    updateSettings({ paymentSource: "credits" });
    const session = activeSession;
    if (!session?.privateMode) return;
    privateCredits.clearCreditsOut(session.id);
    const last = (transcripts[session.id] ?? []).at(-1);
    if (last) {
      void forkSession(last.id, { creditsPrivate: true });
      return;
    }
    const agent = agents.find((candidate) => candidate.id === session.profileId);
    if (!agent) return;
    startSession({
      agent,
      cwd: session.cwd,
      name: nextSessionName(sessions),
      privateMode: { modelId: session.privateMode.modelId },
    });
  };

  const handleSelectSession = (sessionId: string) => {
    setGalleryOpen(false);
    setActiveSessionId(sessionId);
    // An agent picked for a new session that was never started is forgotten.
    setPickedAgentId(null);
    compare.reset();
    const selected = sessionById(sessionId);
    const workspacePath = selected && workspacePathOf(selected);
    if (workspacePath && workspaces.some((ws) => ws.path === workspacePath)) selectWorkspace(workspacePath);
  };

  /** Whether a session's agent can take a prompt now: the test a delegation report is delivered by. */
  const canPrompt = (sessionId: string): boolean => {
    const session = sessionById(sessionId);
    if (session === undefined || session.status !== "running") return false;
    if (isSessionBusy(sessionId) || isSessionWaiting(sessionId) || isAgentRemovedFor(sessionId)) return false;
    const agent = agents.find((candidate) => candidate.id === session.profileId);
    return agent !== undefined && isAgentReady(agent) && signInStatus.stateOf(agent.id) !== "needed";
  };

  const workerStops = useWorkerStops({
    sessions,
    stop: acp.stop,
    markTerminated: (sessionId) => patchSession(sessionId, { status: "terminated", endedAt: Date.now() }),
  });

  /** Reopens a worker whose agent was closed after its turn; the session and its history stayed. */
  const resumeWorker = async (sessionId: string, message: FirstMessage): Promise<boolean> => {
    const session = sessions.find((candidate) => candidate.id === sessionId);
    if (session === undefined || !session.acpSessionId) return false;
    workerStops.forget(sessionId);
    // Its chat may not have been opened in this run: without the load registered first, the task
    // would be saved as the whole conversation, over the history on disk.
    ensureLoaded(sessionId);
    patchSession(sessionId, { status: "running", endedAt: null, exitCode: null });
    // The model last picked for this agent is applied again, as for a user's resume; the draft's own picks are not this worker's.
    return acp.resume(session, session.acpSessionId, message, withPreferred(NO_CHOICES, state.agentOptions?.[session.profileId]));
  };

  const delegation = useDelegation({
    sessions,
    agents,
    transcripts,
    isBusy: isSessionBusy,
    canPrompt,
    isWaiting: isSessionWaiting,
    places: startPlaces,
    send: acp.send,
    resume: resumeWorker,
    canResume: (sessionId) => Boolean(sessions.find((candidate) => candidate.id === sessionId)?.acpSessionId),
    pendingStop: workerStops.pendingStop,
    stopWorker: workerStops.stopWorker,
    isTurnUnderWay: acp.isTurnUnderWay,
    startSession,
    selectSession: handleSelectSession,
    updateLink,
    messagesOf: async (sessionId) => {
      try {
        return await readMessages(sessionId);
      } catch {
        return null;
      }
    },
    giveBack: giveBackMessage,
    onNotice: setNotice,
  });
  // Main window only: a popout must not stop agents.
  useWorkerAutoClose({
    sessions,
    isBusy: isSessionBusy,
    isWaiting: isSessionWaiting,
    canReopen: (sessionId) => acp.info[sessionId]?.canReopen === true,
    isTurnUnderWay: acp.isTurnUnderWay,
    isSendingTo: delegation.isSendingTo,
    hasLiveTasks: (sessionId) =>
      backgroundTasks.tasks.some((task) => task.kind === "shell" && task.sessionId === sessionId),
    hasFailedTurn: (sessionId) => Boolean(failedTurns[sessionId]),
    hasQueuedMessages: (sessionId) => queue.queueOf(sessionId).length > 0,
    stop: workerStops.stopWorker,
  });
  // The engine was built before this hook: its turn ends reach it through the ref.
  delegationTurnEndedRef.current = delegation.onTurnEnded;
  delegationTurnSettledRef.current = delegation.onTurnSettled;
  // A retry reads this when it runs: the hook's latest verdict, not the render that built the engine.
  useEffect(() => {
    delegationBlockedRef.current = delegation.sendBlockedReason;
  });

  /**
   * Archives a session. Archiving either side of a delegation ends its link in the
   * same action: archiving B stops its reports, and archiving A stops reports to a
   * session whose agent the archive ended (they would only pile up in its composer).
   * A failed archive leaves the link open, since the session still runs.
   * Unarchiving does not reopen the link.
   */
  const handleArchiveSession = async (sessionId: string, isArchived: boolean) => {
    await sessionActions.archiveSession(sessionId, isArchived);
    if (!isArchived) return;
    const latestSessions = getState().sessions;
    const isArchivedNow = latestSessions.find((session) => session.id === sessionId)?.archivedAt != null;
    if (!isArchivedNow) return;
    delegation.end(sessionId);
    for (const delegate of openDelegatesOf(sessionId, latestSessions)) delegation.end(delegate.id);
  };

  /** Shows a run's panel in the chat's place; no session stays selected, or the panel would not show. */
  const openRun = (runId: string) => {
    setGalleryOpen(false);
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

  const navigateTo = (sessionId: string | null) => {
    if (sessionId) handleSelectSession(sessionId);
  };

  const updateSettings = (patch: Partial<Settings>) =>
    updateState((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));

  // The setting decides a new draft; a running session keeps the key it was launched with.
  const activeIsOwnKey = activeSession?.privateMode
    ? activeSession.privateMode.ownKey === true
    : state.settings.paymentSource === "ownKey";
  const ownKeySaved = privateCredits.status?.ownKey?.saved !== false;

  usePrivateLowBalanceNotice({
    credits: privateCredits.status?.balance?.credits ?? null,
    notified: state.settings.privateLowBalanceNotified === true,
    onNotified: (notified) => updateSettings({ privateLowBalanceNotified: notified }),
    isOwnKey: activeIsOwnKey,
  });

  const handleOnboardingComplete = ({ defaultAgentId, folder }: OnboardingResult) => {
    updateSettings({ onboardingCompleted: true, defaultAgentId });
    rememberFolder(folder);
    // Start opens a new-session draft in that folder with the agent it started with.
    openNewSession(folder.path, defaultAgentId);
  };

  const handleRunOnboarding = () => {
    settingsPage.close();
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
      // An artifact belongs to its session: its pages go with it. The session is deleted either way.
      invoke("artifact_delete_session", { sessionId }).catch(() => reportError("Could not delete the session's artifacts."));
    },
    [forgetQueued, removeTranscript, reportError],
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
    // An imported session runs as an ordinary one: a private draft does not offer them.
    isShown: Boolean(isNewSessionDraft && newSessionAgent && agentCheck.canListSessions(newSessionAgent.id) && !isWorktreeActive && !privateDraft.isOn),
    listSessions: acp.listSessions, acp, choices: startChoices, onChoicesUsed: () => setAcpChoices(NO_CHOICES),
    recordSession, openSession: handleSelectSession, discardSession: sessionActions.discardSession, openNewSession, requestSignIn: signIn.auth.requestSignIn,
  });

  /** Resolves to whether the agent took the message. */
  const sendTo = async (sessionId: string, message: FirstMessage) => {
    compareRun.dropSignIn(sessionId);
    const session = sessionById(sessionId);
    // A numbered session takes its title from the first thing the user asks.
    const isFirstMessage = !(transcripts[sessionId]?.some((m) => m.role === "user") ?? false);
    const sent = await acp.send(sessionId, message.text, message.attachments);
    if (sent && session && isFirstMessage && isAutoName(session.name) && !session.namedByUser) {
      patchSession(sessionId, { titleSource: undefined, ...namingFor(message, titlePlaceOf(session, agents)) });
    }
    return sent;
  };

  /** Sends what the composer held; a message the delegation pair blocks, or the agent did not take, goes back. */
  const sendFromComposer = (sessionId: string, message: FirstMessage) => {
    if (delegation.sendBlockedReason(sessionId) !== null) {
      giveBackMessage(sessionId, message.text, message.attachments);
      return;
    }
    void sendTo(sessionId, message).then((isTaken) => {
      if (!isTaken) giveBackMessage(sessionId, message.text, message.attachments);
    });
  };

  /**
   * Continues an ended ACP session: a fresh agent process loads it, then gets
   * the message. A rewound one has no agent session left to load.
   */
  const resumeSession = (session: Session, message: FirstMessage, options?: { keepUnsent?: boolean }): Promise<boolean | null> => {
    compareRun.dropSignIn(session.id);
    if (!session.acpSessionId) {
      // A rewound session: `restart` gives the message back itself.
      void restart(session, message, startChoices);
      setAcpChoices(NO_CHOICES);
      // The outcome is not known here, so the queue announces nothing for it.
      return Promise.resolve(null);
    }
    // Continuing an archived session brings it back into the list.
    patchSession(session.id, { status: "running", endedAt: null, exitCode: null, archivedAt: null });
    const taken = acp.resume(session, session.acpSessionId, message, startChoices).then((isTaken) => {
      // The queue gives back and announces for itself (`keepUnsent`): it must know whether the agent took the message.
      if (!isTaken && !options?.keepUnsent) giveBackMessage(session.id, message.text, message.attachments);
      return isTaken;
    });
    setAcpChoices(NO_CHOICES);
    return taken;
  };

  /** Sends one queued message the way the composer's Send does; false when the agent or the delegation pair refused it. */
  const deliverQueued = async (sessionId: string, queued: QueuedMessage, mode: "send" | "resume") => {
    const session = sessionById(sessionId);
    if (!session) return false;
    const message = { text: queued.text, attachments: [...queued.attachments] };
    if (mode === "resume") {
      return resumeSession(session, message, { keepUnsent: true });
    }
    if (delegation.sendBlockedReason(sessionId) !== null) return false;
    return sendTo(sessionId, message);
  };
  /** The composer's own rule for continuing an ended session: its agent is ready. */
  const canResumeSession = (sessionId: string) => {
    const session = sessionById(sessionId);
    return session !== undefined && session.status !== "running" && agents.find((a) => a.id === session.profileId)?.detected === true;
  };
  const queue = useQueuedMessages({
    sessionIds: sessions.map((s) => s.id),
    deliver: deliverQueued,
    stop: handleInterrupt,
    giveBack: giveBackMessage,
    focusComposer: () => composerRef.current?.focus(),
    isWaiting: isSessionWaiting,
    isTurnUnderWay: acp.isTurnUnderWay,
    isStarting: acp.isStarting,
    isEnded: (sessionId) => sessionById(sessionId)?.status !== "running",
    canResume: canResumeSession,
    agentNameOf: (sessionId) => agents.find((a) => a.id === sessionById(sessionId)?.profileId)?.name ?? "The agent",
    onNotice: setNotice,
  });
  queueTurnSettledRef.current = queue.onTurnSettled;
  queueAgentEndedRef.current = queue.onAgentEnded;
  queuePromptStartedRef.current = queue.onPromptStarted;
  queueRewoundRef.current = queue.clearForRewind;
  // What was announced belongs to the session on screen: another session starts quiet.
  const { clearAnnouncement } = queue;
  useEffect(() => clearAnnouncement(), [activeSessionId, clearAnnouncement]);

  // Read when a run's worktrees are done, seconds after the click: an empty session id also means a run's panel.
  const isDraftRef = useLatest(isNewSessionDraft);
  // A rewound message names its session, and goes into no other session's box. A draft's message goes into the next composer shown.
  const pendingRestoreRef = useRef<(FirstMessage & { sessionId?: string }) | null>(null);
  useEffect(() => {
    const pending = pendingRestoreRef.current;
    if (!pending) return;
    if (pending.sessionId !== undefined && !sessions.some((s) => s.id === pending.sessionId)) pendingRestoreRef.current = null;
    if (!pendingRestoreRef.current || !composerRef.current || isComposerHidden) return;
    if (pending.sessionId !== undefined && (pending.sessionId !== activeSessionId || isAgentRemovedFor(pending.sessionId))) return;
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
      // The message waits for the new draft to show the composer.
      if (composerRef.current && !isComposerHiddenRef.current) composerRef.current.restore(message.text, message.attachments);
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
  // The session on screen when it is not in a compare run (a run's sessions share one title, as the sidebar's menu has it).
  const sessionOfItsOwn = activeSession && !compareRun.isInRun(activeSession.id) ? activeSession : undefined;
  // However a session comes on screen, its refusal is taken up there: only now does its composer show.
  const { takeSignIn } = compareRun;
  const refusedHere = compareRun.signInNeeded.get(activeSessionId);
  useEffect(() => {
    if (refusedHere) takeSignIn(activeSessionId);
  }, [activeSessionId, refusedHere, takeSignIn]);

  const runRows = useCompareRunRows(activeRun, { ...rowSources, signInNeeded: compareRun.signInNeeded, ensureLoaded });
  /** Starts the ticked agents on one prompt, each in its own worktree. */
  const handleNewRun = (message: FirstMessage) => {
    if (!activeWorkspace) {
      setNotice(NO_FOLDER_NOTICE, "warning");
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
    updateArtifactComments,
    composerRef,
    canContinue: isActiveRunning || isResumable,
    hasComposer: activeAgentRemoved === null,
    isComposerDisabled,
    collapseDiff: inspector.collapseDiff,
    collapseArtifact: () => inspector.setArtifactExpanded(false),
    agentNameOf: (profileId) => agents.find((a) => a.id === profileId)?.name ?? profileId,
  });
  rearmReviewRef.current = review.rearm;
  forgetReviewRef.current = review.forget;

  /** What a delegation to an agent starts with: the picks, and the agent's remembered model and effort. */
  const delegationChoicesFor = (agentId: string): AcpChoices =>
    delegationChoicesForOptions(state.agentOptions?.[agentId]);

  /** True when a message sent now joins the session's queue: a turn is under way (read from refs) and no comments are held. */
  const isQueueingNow = (sessionId: string) =>
    isQueueingActive && sessionId === activeSessionId && acp.isTurnUnderWay(sessionId) && !acp.isStarting(sessionId);

  /** Sends to the active session, continues it when it can be resumed, or starts a new one (or a run). */
  const handleSendMessage = (text: string, attachments?: string[]) => {
    const message = { text, attachments };
    // A mention is the whole message: it starts the other agent instead of sending this one.
    if (delegationMention !== null && activeSession !== undefined) {
      const sourceId = activeSession.id;
      const { agentId, task } = delegationMention;
      void delegation
        .start(sourceId, agentId, task, {
          attachments,
          choices: delegationChoicesFor(agentId),
        })
        .then((isStarted) => {
          if (!isStarted) giveBackMessage(sourceId, text, attachments);
        });
      return;
    }
    // While a turn runs, a message waits in the session's queue. The secret guard scans it now, with the user
    // at the keyboard; the queue later sends it through `sendTo`, which scans nothing again.
    if (activeSession !== undefined && isQueueingNow(activeSession.id)) {
      const sessionId = activeSession.id;
      secretGuard.check(
        message,
        () => {
          // The turn may have ended during the scan: no turn end is left to send it.
          if (!acp.isTurnUnderWay(sessionId)) sendFromComposer(sessionId, message);
          else if (!queue.add(sessionId, text, attachments ?? [])) giveBackMessage(sessionId, text, attachments);
        },
        {
          isEnabled: isPrivateLaunch && state.settings.secretGuard !== false,
          root: activeSession.cwd ?? activeWorkspacePath,
          agentName: activeAgent?.name ?? "The agent",
          sessionId,
        },
      );
      return;
    }
    // The pair's report hand-over blocks both sides; nothing goes out, and held review comments stay held.
    if (activeSession !== undefined && delegation.sendBlockedReason(activeSession.id) !== null) {
      giveBackMessage(activeSession.id, text, attachments);
      return;
    }
    // The composer empties on Send, which clears the slot; keep it so the comments still go with this
    // message after a secret review, whether the user picks Send anyway or edits and sends again.
    const reviewSlot = review.slot;
    const deliver = () => {
      if (reviewSlot) review.rearm(reviewSlot);
      if (activeSession && isActiveRunning) {
        review.sendFrom(activeSession.id, text);
        sendFromComposer(activeSession.id, message);
      } else if (activeSession && isResumable) {
        review.sendFrom(activeSession.id, text);
        void resumeSession(activeSession, message);
      } else if (compare.isCompare) handleNewRun(message);
      else void handleNewSession(message);
    };
    // A private message pauses here when it may hold a secret; nothing goes out until the user picks.
    secretGuard.check(message, deliver, {
      isEnabled: isPrivateLaunch && state.settings.secretGuard !== false,
      root: activeSession?.cwd ?? activeWorkspacePath,
      agentName: activeAgent?.name ?? newSessionAgent?.name ?? "The agent",
      sessionId: activeSession?.id,
      ...(reviewSlot ? { reviewSlot } : {}),
    });
  };

  /** What the @ list and the dialog say about an agent: its install and sign-in state, as the draft's rows do. */
  const delegationStatusOf = (agent: AgentProfile): MentionAgentStatus => {
    if (!isAgentReady(agent)) return "not-installed";
    const signIn = signInStatus.stateOf(agent.id);
    return signIn === "needed" ? "needs-sign-in" : signIn === "ready" ? "ready" : "not-checked";
  };

  const mentionedAgent =
    delegationMention === null ? undefined : agents.find((agent) => agent.id === delegationMention.agentId);

  // A mention is the whole message, so the @ group shows only for a session of its own that may delegate.
  const activeDelegateBlockedReason = sessionOfItsOwn
    ? delegation.delegateBlockedReason(sessionOfItsOwn.id)
    : null;
  const mayDelegateHere =
    activeSession !== undefined &&
    !compareRun.isInRun(activeSession.id) &&
    activeSession.delegatedFrom == null &&
    activeDelegateBlockedReason !== "";
  const delegationAgents = mayDelegateHere
    ? agentsInUse.map((agent) => ({
        id: agent.id,
        name: agent.name,
        status: delegationStatusOf(agent),
      }))
    : undefined;

  const delegateDialog = useDelegateDialog({
    agents,
    agentOptions: state.agentOptions,
    probe: compareModelProbe,
    sourceId: activeSession?.id,
    start: delegation.start,
    composerRef,
    menuButtonRef: moreOptionsButtonRef,
  });

  const mentionBlock = delegationMention === null || mentionedAgent === undefined
    ? null
    : mentionBlockedReason({
        agentName: mentionedAgent.name,
        task: delegationMention.task,
        status: delegationStatusOf(mentionedAgent),
        delegateReason: activeSession ? delegation.delegateBlockedReason(activeSession.id, mentionedAgent.id) : null,
      });
  // Why Send waits: the mention's own reason first, then the pair's report hand-over.
  const delegationBlock = mentionBlock ?? (activeSession ? delegation.sendBlockedReason(activeSession.id) : null) ?? undefined;
  /** What B starts on, under A's prompt; only while the mention names an agent that can start. */
  const delegationSummary =
    delegationMention !== null && mentionedAgent !== undefined && mentionBlock === null
      ? {
          // The agent has exactly one worker here: the task goes to it, and nothing new starts.
          text:
            activeSession !== undefined && soleOpenDelegateOf(activeSession.id, mentionedAgent.id, sessions) !== undefined
              ? followUpSummary(mentionedAgent.name)
              : startSummary({
                  agentName: mentionedAgent.name,
                  ...delegatedStartOf(state.agentOptions?.[mentionedAgent.id]),
                }),
          onChange: (attachments?: readonly string[]) =>
            delegateDialog.open({
              initialAgentId: mentionedAgent.id,
              initialTask: delegationMention.task,
              attachments,
              clearsComposer: true,
              returnsFocusToMenu: false,
            }),
        }
      : undefined;
  const delegationSendLabel =
    delegationMention !== null && mentionedAgent !== undefined ? `Delegate to ${mentionedAgent.name}` : undefined;

  const delegateAgents: readonly DelegateAgentChoice[] = agentsInUse.map((agent) => ({
    profile: agent,
    status: delegationStatusOf(agent),
    // Its task would go to its one worker here, which keeps its own model and mode.
    ...(activeSession !== undefined && soleOpenDelegateOf(activeSession.id, agent.id, sessions) !== undefined
      ? { hasDelegate: true }
      : {}),
  }));

  // End delegation: one item per open delegate of A, or B's own open link. A delegated session offers no Delegate of its own.
  const openDelegates = sessionOfItsOwn ? openDelegatesOf(sessionOfItsOwn.id, sessions) : [];
  const delegationEnds =
    openDelegates.length > 0
      ? openDelegates.map((delegate) => ({
          label:
            openDelegates.length === 1
              ? "End delegation"
              : `End delegation to ${agents.find((agent) => agent.id === delegate.profileId)?.name ?? delegate.profileId}`,
          run: () => delegation.end(delegate.id),
        }))
      : sessionOfItsOwn !== undefined && isOpenLink(sessionOfItsOwn.delegatedFrom)
        ? [{ label: "End delegation", run: () => delegation.end(sessionOfItsOwn.id) }]
        : undefined;
  // The session's agent may give other agents tasks without asking: the menu takes that back.
  const onStopAllowingDelegation =
    sessionOfItsOwn !== undefined && agentTools.hasGrant(sessionOfItsOwn.id)
      ? () => agentTools.revokeGrant(sessionOfItsOwn.id)
      : undefined;
  const activeComputerUse = sessionOfItsOwn ? computerUse.grantOf(sessionOfItsOwn.id) : undefined;
  const onStopComputerUse =
    sessionOfItsOwn !== undefined && activeComputerUse !== undefined
      ? () => computerUse.stop(sessionOfItsOwn.id)
      : undefined;
  const onDelegate =
    sessionOfItsOwn !== undefined && sessionOfItsOwn.delegatedFrom == null
      ? () => delegateDialog.open({ clearsComposer: false, returnsFocusToMenu: true })
      : undefined;

  // A's line while B works or waits, and B's while A works on its report; while A is in a turn its own status shows.
  // The session whose agent opened this one, when it still exists.
  const openerSession = activeSession?.openedBy ? sessionById(activeSession.openedBy.sessionId) : undefined;
  const delegationViews = activeSession ? delegation.viewsFor(activeSession.id) : [];
  // B's own line, or the first of A's: the region that announces the lines stays mounted on it.
  const delegationView = delegationViews[0] ?? null;
  const shownDelegationViews = isSessionBusy(activeSessionId)
    ? []
    : delegationViews.filter(
        (view) =>
          (view.role === "source" &&
            (view.state === "working" || view.state === "needs-answer" || view.state === "failed")) ||
          view.state === "source-working",
      );
  const isDelegationWorking = shownDelegationViews.some(
    (view) => view.state === "working" || view.state === "source-working",
  );
  // One-second ticks while a working line shows; the time is read in whole seconds, as the canvas draws it.
  const delegationNow = useNow(1000, isDelegationWorking);

  const chooseOption = (sessionId: string, cardId: string, optionId: string, answers?: Record<string, string>) => {
    // A card Zorvo made for an agent's tool call is answered by Zorvo's tools, not by the agent.
    if (agentTools.chooseCard(sessionId, cardId, optionId)) return;
    // So is an agent's request to use apps: the ticks go to Zorvo's backend as row keys.
    if (computerUse.chooseCard(sessionId, cardId, optionId, answers)) return;
    // One that is no longer open (its call ended) has no answer to give, least of all to the agent.
    if (isComputerUseCardId(cardId)) return;
    acp.chooseOption(sessionId, transcripts[sessionId], cardId, optionId, answers);
  };

  usePopoutHost({
    sessions,
    transcripts,
    ensureLoaded,
    statusOf: (sessionId) => ({
      isBusy: isSessionBusy(sessionId),
      isWaiting: isSessionWaiting(sessionId),
      contextUsage: acp.info[sessionId]?.usage,
      failures: acp.failuresOf(sessionId),
      sendBlockedReason: delegation.sendBlockedReason(sessionId),
      privateCreditsOut: privateCredits.creditsOut[sessionId],
      privateTopupRequest: topupRequests.requests[sessionId] ?? null,
    }),
    agentCatalog: { agents, settings: state.settings, addAgent: catalogActions.addAgent },
    onAction: (sessionId, action) => {
      if (action.kind === "send") {
        // A refusal cannot be given back here: a popout has no give-back action.
        if (delegation.sendBlockedReason(sessionId) !== null) return;
        const session = sessionById(sessionId);
        secretGuard.check(
          { text: action.text },
          () => {
            if (!refusesSend(sessionId)) void sendTo(sessionId, { text: action.text });
          },
          {
            isEnabled: Boolean(session?.privateMode) && state.settings.secretGuard !== false,
            root: session?.cwd,
            agentName: agentNameOr(agents.find((agent) => agent.id === session?.profileId)),
            sessionId,
          },
        );
      } else if (action.kind === "stop") handleInterrupt(sessionId);
      else if (action.kind === "answer-elicitation") acp.answerElicitation(sessionId, action.key, action.answer);
      else if (action.kind === "reopen-elicitation-url") acp.reopenElicitationUrl(sessionId, action.key);
      else if (action.kind === "open-url") openLink(action.url);
      else if (action.kind === "approve-topup") void answerTopupRequest(sessionId, action.requestId, true);
      else if (action.kind === "decline-topup") void answerTopupRequest(sessionId, action.requestId, false);
      else chooseOption(sessionId, action.cardId, action.optionId, action.answers);
    },
  });

  // A new session is not in the history: Back from it returns to the session viewed last.
  const lastViewedSessionId = navigation.current && sessionById(navigation.current) ? navigation.current : null;
  const canGoBack = !activeSession ? lastViewedSessionId !== null : navigation.canGoBack;

  const currentMessages = transcripts[activeSessionId] ?? [];
  // The overview card beside the chat, worked out from what the app already holds; only again when one of those changes,
  // since a streamed reply renders App on every frame.
  const isActiveSessionBusy = activeSession ? isSessionBusy(activeSession.id) : false;
  const sessionOverview = useMemo(
    () =>
      activeSession
        ? overviewOf({
            messages: activeTranscript ?? [],
            isBusy: isActiveSessionBusy,
            shellTasks: sessionShellTasks,
            pages: sessionArtifacts,
            files: createdFiles,
            pullRequest,
            agentTasks: agentTasks?.tasks,
            agentTasksAsOf: agentTasks?.asOf,
          })
        : null,
    [activeSession, activeTranscript, isActiveSessionBusy, sessionShellTasks, sessionArtifacts, createdFiles, pullRequest, agentTasks],
  );
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
    isPrivate: privateDraft.isOn,
  });
  // Several agents are not asked and nothing is picked for them yet: Send only waits for the single agent's install or sign-in.
  // The note promises one worktree each, so while the folder is not known to be a repository (still loading, or unreadable) Send waits too.
  const isSendWaiting = compare.isCompare
    ? !canUseWorktree
    : draftNeedsInstall || draftNeedsSignIn || privateDraft.blocksSend || creditsOutReason !== undefined;
  // A draft's message is still being checked for secrets: a second Send would start a second session.
  // Only Send waits; disabling the box would take the focus away from what the user types next.
  const isCheckingDraftSecrets = isNewSessionDraft && secretGuard.isCheckingDraft;
  // A message sent while the agent works waits in a queue, unless review comments are held: those are marked Sent at Send.
  const canQueueActive =
    activeSession !== undefined &&
    isActiveRunning &&
    acp.isBusy(activeSessionId) &&
    !acp.isStarting(activeSessionId) &&
    !isRestarting(activeSessionId);
  const isQueueingActive = canQueueActive && review.slot === null;
  const isQueueFull = isQueueingActive && queue.isFull(activeSessionId);
  // The composer's own rule for a blocked Send; a queued row's Send now follows it, with the note the composer shows.
  const isComposerSendBlocked = isSendWaiting || isCheckingDraftSecrets || review.blocksSend || delegationBlock !== undefined;
  const isSendBlocked = isComposerSendBlocked || isQueueFull;
  const privateModelId = activeSession?.privateMode?.modelId ?? privateDraft.privateMode?.modelId;
  const privateModel = privateCredits.models?.find((model) => model.id === privateModelId);
  const privateSessionCap = activeSession?.privateMode?.sessionCap;
  const privateSessionLine =
    activeSession && privateSessionCap !== undefined && !activeIsOwnKey
      ? `${Math.floor(activeSession.privateUsage?.credits ?? 0)} of ${privateSessionCap} credits this session`
      : undefined;
  const livePrivateCredits = privateCredits.status?.balance?.credits;
  const activeTopupRequest = activeSession ? topupRequests.requests[activeSession.id] : undefined;
  const privateLowNote =
    isPrivateLaunch && !activeIsOwnKey && livePrivateCredits !== undefined
      ? lowBalanceNote(livePrivateCredits, privateModel)
      : undefined;
  const composerNoteText = composerNote({
    reviewOwner: review.reviewOwner,
    compareCount: compare.agentIds.length,
    agentToInstall: draftNeedsInstall ? draftAgent?.name : undefined,
    agentToSignIn: draftNeedsSignIn ? draftAgent?.name : undefined,
    privateNote: isPrivateLaunch ? privateDraft.note ?? creditsOutNote : undefined,
    delegationBlock,
    queueFull: isQueueFull,
    commentsWaitFor: canQueueActive && review.slot?.sessionId === activeSessionId ? activeAgent?.name ?? "The agent" : undefined,
    continuesSession: isResumable || Boolean(activeSession),
  });
  const composerCommands = composerCommandsFor({
    isRunning: isActiveRunning,
    liveCommands: acp.info[activeSessionId]?.commands,
    draftAgent,
    agentOptions: state.agentOptions,
    isPrivate: isPrivateLaunch,
  });

  // Shown in the sessions' column, or on the Settings page while that hides the column; never both.
  const noticeToast = notice && <Toast tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />;
  const busyCount = sessions.filter((session) => isSessionBusy(session.id)).length;

  if (isLoaded && !state.settings.onboardingCompleted) {
    return (
      <Onboarding
        catalog={agentCatalog.catalog}
        agents={agents}
        settings={state.settings}
        signInStateOf={signInStatus.stateOf}
        isSetupOnly={(id) => isSetupOnly(settingsSignIn.methodsOf(id))}
        onTick={catalogActions.markAgent}
        onInstall={catalogActions.addAgent}
        onUntick={catalogActions.unmarkAgent}
        onMakeDefault={(defaultAgentId) => updateSettings({ defaultAgentId })}
        onUpdate={catalogActions.updateAgent}
        recentFolders={workspaces}
        suggestedFolders={suggestedFolders}
        onPickFolder={openFolder}
        onComplete={handleOnboardingComplete}
        areAgentsLoaded={areAgentsLoaded}
        agentsError={agentsError}
        catalogError={agentCatalog.error}
        onRetryCatalog={() => void agentCatalog.reload()}
        onCheckAgain={() => recheckAgents(refreshAgents, agentCatalog.reload)}
        notice={noticeToast}
      />
    );
  }

  // A canvas's Pick and Build put text in the message box on the same terms as Reply.
  const canvasInsertBlockedReason = replyBlockedReason({ isComposerHidden, isComposerDisabled, isHeldElsewhere: review.isHeldFor(activeSessionId) });
  // An expanded canvas hides the composer, so it is left first and the text lands where it can be seen.
  const canvasInsertText = review.insertCanvasText;

  return (
    <main className="flex h-screen w-screen flex-col bg-ground text-fg-secondary">
      {/* Hidden, not unmounted, while Settings shows: a draft, its comments and the terminals stay as they were. */}
      <section hidden={settingsPage.section !== null} className="flex flex-1 overflow-hidden">
        <Sidebar
          isHidden={isSidebarHidden}
          onHide={() => setSidebarHidden(true)}
          artifactCount={gallery.length}
          isGalleryOpen={isGalleryShown}
          onOpenGallery={() => setGalleryOpen(true)}
          workspaces={workspaces}
          activeWorkspacePath={activeWorkspacePath}
          sessions={sessions}
          activeSessionId={activeSessionId}
          activeRunId={activeRun?.id}
          agents={agents}
          settings={state.settings}
          onNewSession={() => openNewSession()}
          onSelectSession={handleSelectSession}
          onOpenRun={openRun}
          onNewSessionIn={openNewSession}
          defaultAgentId={defaultAgentId ?? undefined}
          isSessionBusy={isSessionBusy}
          pullRequestOf={pullRequestOf}
          isSessionWaiting={isSessionWaiting}
          usesComputer={(sessionId) => computerUse.grantOf(sessionId) !== undefined}
          onStopSession={handleInterrupt}
          onDeleteSession={sessionActions.deleteSession}
          onRenameSession={sessionActions.renameSession}
          onPinSession={sessionActions.pinSession}
          onArchiveSession={(sessionId, isArchived) => void handleArchiveSession(sessionId, isArchived)}
          footer={
            <ProfileFooter
              name={userProfile.name}
              email={userProfile.email}
              github={github.status}
              updateCount={agentUpdates.updateCount}
              onOpenSettings={() => settingsPage.open("general")}
              settingsButtonRef={settingsButtonRef}
              agents={
                <AgentsMenu
                  agents={agents}
                  settings={state.settings}
                  signInStateOf={signInStatus.stateOf}
                  onSetUpAgent={(profileId) => {
                    openNewSession(undefined, profileId);
                    // Asks again even when this agent is already the draft's: its panel may have been dismissed.
                    agentCheck.reprobe(profileId);
                  }}
                  onManageAgents={() => settingsPage.open("agents")}
                />
              }
            />
          }
        />

        <div data-stage data-tauri-drag-region className={`flex min-w-0 flex-1 gap-2 py-2 pr-2${isSidebarHidden ? " pl-2" : ""}`}>
          {isGalleryShown && (
            <ArtifactGallery
              rows={gallery}
              onOpen={openFromGallery}
              onOpenCanvas={openCanvasFromGallery}
              onError={reportError}
              onShowSidebar={isSidebarHidden ? () => setSidebarHidden(false) : undefined}
              notice={settingsPage.section === null && noticeToast}
            />
          )}
          {/* Hidden, not unmounted, under the gallery: the composer keeps its text. */}
          <div data-sheet="main" className={`${isGalleryShown ? "hidden" : "flex"} min-w-0 flex-1 flex-col overflow-hidden rounded-panel border border-border bg-sheet`}>
            <TopBar
              onShowSidebar={isSidebarHidden ? () => setSidebarHidden(false) : undefined}
              hasTrafficLights={isSidebarHidden}
              sessionId={activeSession?.id ?? activeRun?.id}
              sessionName={activeSession?.name ?? activeRun?.name}
              isPrivate={Boolean(activeSession?.privateMode)}
              // A run's sessions share one title, so only a session of its own is renamed or archived here.
              onRename={sessionOfItsOwn ? (name) => sessionActions.renameSession(sessionOfItsOwn.id, name) : undefined}
              // Archiving ends the agent, so, as in the sidebar's menu, it waits until the agent is not working.
              onArchive={
                sessionOfItsOwn && !isSessionBusy(sessionOfItsOwn.id)
                  ? () => void handleArchiveSession(sessionOfItsOwn.id, true)
                  : undefined
              }
              onReveal={shownFolderPath ? () => shell.revealFolder(shownFolderPath) : undefined}
              onDelegate={onDelegate}
              delegateBlockedReason={activeDelegateBlockedReason}
              delegationEnds={delegationEnds}
              onStopAllowingDelegation={onStopAllowingDelegation}
              onStopComputerUse={onStopComputerUse}
              moreButtonRef={moreOptionsButtonRef}
              workspaceName={activeSession ? folderNameOf(workspacePathOf(activeSession)) : activeWorkspace?.name}
              // A run takes its folder from its first session, never from the last folder chosen.
              folderName={
                activeSession
                  ? folderNameOf(workspacePathOf(activeSession))
                  : activeRun
                    ? folderNameOf(workspacePathOf(activeRun.sessions[0]))
                    : activeWorkspace?.name
              }
              runAgentCount={activeRun?.sessions.length}
              isDraft={isNewSessionDraft}
              // A session's branch and pull request are in its overview card; a run's panel has no card.
              branch={activeSession ? undefined : (workspaceDetails?.branch ?? undefined)}
              canGoBack={canGoBack}
              canGoForward={navigation.canGoForward}
              onBack={() => navigateTo(!activeSession ? lastViewedSessionId : navigation.back())}
              onForward={() => navigateTo(navigation.forward())}
              onToggleInspector={inspectorTabs.length > 0 ? () => inspector.toggle(inspectorTabs) : undefined}
              isInspectorOpen={inspectorTab !== null}
              inspectorButtonRef={inspectorButtonRef}
              diffStats={diffStats}
              isDiffAlwaysShown={Boolean(startCommit) || reviewComments.comments.length > 0}
              diffCommentCount={unsentCommentCount}
              onOpenDiff={inspectorTabs.includes("changes") ? () => inspector.openDiff() : undefined}
              onPopout={activeSession ? () => shell.popout(activeSession.id) : undefined}
              plan={sessionPlan}
              planSource={activeAgent?.name}
            />
            {/* A container, so the overview card gives way to its pill on a narrow sheet (an inspector open beside it). */}
            <div className="@container relative flex min-h-0 flex-1">
              {/* A still frame: the drop overlay is placed against it and the update banner sits on it, so both stay on
                  screen whatever the column under them is scrolled to. */}
              <article className={`${(isDiffOpen && inspector.isDiffExpanded) || isArtifactExpanded ? "hidden" : "flex"} flex-1 flex-col relative overflow-hidden`}>
                {isDraggingFiles && <FileDropOverlay />}
                <UpdateNotice
                  agents={agentUpdates.unnotified}
                  onShow={() => { agentUpdates.acknowledge(); settingsPage.open("agents"); }}
                  onDismiss={agentUpdates.acknowledge}
                />
                {/* The chat or the draft. It scrolls only when what it holds does not fit (a short window, a sign-in panel
                    above the composer), so Send is always reachable; the chat and a draft's sessions scroll inside it. It
                    is always rendered, so the composer keeps its place in the tree, and its text. A draft keeps room for
                    the scrollbar, so the centred column does not jump when one appears. */}
                <div
                  ref={mainColumnRef}
                  data-main-column=""
                  className={`flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden${draftWorkspace ? " [scrollbar-gutter:stable]" : ""}`}
                >
                  {activeRun ? (
                    <CompareRunPanel
                      run={activeRun}
                      rows={runRows}
                      version={runVersion}
                      agentName={(profileId) => agents.find((a) => a.id === profileId)?.name ?? profileId}
                      onOpen={handleSelectSession}
                      onReview={(sessionId) => {
                        handleSelectSession(sessionId);
                        // The review is for the session that comes on screen, not for the run's panel.
                        inspector.openDiff(sessionId);
                      }}
                      onChoose={chooseOption}
                      onPick={(winnerId) => compareRun.pick(activeRun, winnerId)}
                    />
                  ) : activeSession && (currentMessages.length > 0 || isSessionBusy(activeSessionId) || activeSession.historyElsewhere) ? (
                    <ChatCanvas
                      conversationId={activeSessionId}
                      visualSessionId={activeSessionId ?? undefined}
                      messages={currentMessages}
                      jumpTo={chatJump}
                      onJumped={() => setChatJump(null)}
                      agentName={activeAgent?.name}
                      agentProfileId={activeSession?.profileId}
                      onForkBranch={(messageId) => void forkSession(messageId)}
                      onReply={(quote) => composerRef.current?.insertText(quote)}
                      onOpenUrl={openLink}
                      privateModelId={activeSession?.privateMode?.modelId}
                      privateModel={activeSession?.privateMode ? privateModel : undefined}
                      replyBlockedReason={replyBlockedReason({
                        isComposerHidden,
                        isComposerDisabled,
                        isHeldElsewhere: review.isHeldFor(activeSessionId),
                      })}
                      onRewind={(messageId) => { compareRun.dropSignIn(activeSessionId); void rewind(activeSession, messageId); }}
                      // The sidebar and the top bar say where a session runs; only an imported
                      // session's note sits above its first message.
                      header={
                        activeSession.historyElsewhere ? (
                          <HistoryElsewhereNote agentName={agentNameOr(activeAgent)} />
                        ) : undefined
                      }
                      delegatedFrom={
                        delegationView?.role === "delegate" ? (
                          <DelegatedFromLine view={delegationView} onOpen={handleSelectSession} canAct />
                        ) : activeSession?.openedBy ? (
                          // A session an agent opened: who opened it, in the delegate line's place.
                          <OpenedByLine
                            agentName={agents.find((agent) => agent.id === openerSession?.profileId)?.name ?? ""}
                            sessionName={openerSession?.name ?? ""}
                            openerSessionId={openerSession?.id ?? null}
                            onOpen={handleSelectSession}
                            canAct
                          />
                        ) : undefined
                      }
                      computerUseStatus={
                        <ComputerUseStatusLine grant={activeComputerUse} onStop={onStopComputerUse} />
                      }
                      // Always mounted for a session, so the first line it draws is announced.
                      delegationStatus={
                        shownDelegationViews.length === 0 ? (
                          <DelegationStatusLine
                            view={delegationView}
                            now={delegationNow}
                            onOpen={handleSelectSession}
                            canAct
                            hidden
                            delegateAgentName={delegationView?.role === "delegate" ? activeAgent?.name : undefined}
                          />
                        ) : (
                          // One line per delegate that works, waits or failed, oldest first.
                          shownDelegationViews.map((view) => (
                            <DelegationStatusLine
                              key={view.otherSessionId ?? "source-gone"}
                              view={view}
                              now={delegationNow}
                              onOpen={handleSelectSession}
                              canAct
                              delegateAgentName={view.role === "delegate" ? activeAgent?.name : undefined}
                            />
                          ))
                        )
                      }
                      // A turn that failed says so under its last message, with Try again.
                      footer={
                        failedTurns[activeSessionId] ? (
                          <FailedTurnBanner
                            agentName={activeAgent?.name}
                            error={failedTurns[activeSessionId]}
                            isBusy={isSessionBusy(activeSessionId)}
                            onRetry={
                              acp.hasFailedPrompt(activeSessionId)
                                ? () => void acp.retryFailedTurn(activeSessionId, (unsent) => giveBackMessage(activeSessionId, unsent.text, unsent.attachments))
                                : undefined
                            }
                            onDismiss={() => clearFailedTurn(activeSessionId)}
                          />
                        ) : undefined
                      }
                      onChooseOption={(cardId, optionId, answers) => chooseOption(activeSessionId, cardId, optionId, answers)}
                      onAnswerElicitation={(key, answer) => acp.answerElicitation(activeSessionId, key, answer)}
                      onReopenElicitationUrl={(key) => acp.reopenElicitationUrl(activeSessionId, key)}
                      artifactIds={artifactIds}
                      onOpenArtifact={openArtifactCard}
                      // After Stop the agent is the one to act, whatever card still waits: End agent must be reachable.
                      isWorking={
                        isSessionBusy(activeSessionId) &&
                        (!isAwaitingUser(currentMessages) || acp.stopAskedAt(activeSessionId) !== undefined)
                      }
                      failures={acp.failuresOf(activeSessionId)}
                      agentTasks={agentTasks}
                      onStop={() => handleInterrupt(activeSessionId)}
                      stopAskedAt={acp.stopAskedAt(activeSessionId)}
                      onEndAgent={() => void acp.endAgent(activeSessionId)}
                    />
                  ) : draftWorkspace ? (
                    // Room above the draft's card (the composer, below), as much as under it, so the card sits in the middle.
                    <NewSessionAbove
                      unavailableReason={areAgentsLoaded && !agentsInUse.some(isAgentReady) ? noAgentNotice(agentsInUse) : undefined}
                    />
                  ) : isNewSessionDraft ? (
                    <EmptyFolderState onOpenFolder={() => void openFolder()} />
                  ) : (
                    // A session with no messages yet (its transcript may still be loading): only its composer, at the bottom.
                    <div className="flex-1" />
                  )}

                  {/* Anchored at the composer's top edge, so the cards float over the chat and never over Send or Stop. */}
                  <div className="relative h-0">
                    <ToastStack>
                      <AppUpdateNotice
                        update={appUpdate.update}
                        busyCount={busyCount}
                        terminalCount={terminals.liveCount}
                        isInstalling={appUpdate.isInstalling}
                        progress={appUpdate.progress}
                        onInstall={() => void appUpdate.install()}
                        onLater={appUpdate.dismiss}
                      />
                      {settingsPage.section === null && noticeToast}
                    </ToastStack>
                  </div>
                  {activeAgentRemoved !== null && (
                    <div className="p-4 flex justify-center">
                      <RemovedAgentPanel
                        agentName={activeAgentRemoved}
                        profileId={activeSession?.profileId}
                        onAdd={() => activeAgent && catalogActions.addAgent(activeAgent.id)}
                      />
                    </div>
                  )}
                  {/* The blockers sit right above the composer, which stays: a prompt can be written meanwhile. */}
                  {/* As wide as the composer's card: the gutter sits outside the 680px column, as the dock's does. */}
                  {/* In a draft the panels go into the composer's slot under its chips, so they read in order. */}
                  <div className="px-6">
                    <div className="mx-auto w-full max-w-chat space-y-3">
                      <SignInLayer
                        signIn={signIn}
                        agents={agents}
                        // A request for the agent stays, unseen, while a private draft or session is on screen.
                        agentId={isPrivateLaunch ? undefined : (activeSession?.profileId ?? (activeRun ? undefined : newSessionAgent?.id))}
                        showTerminal={settingsPage.section === null}
                        panelTarget={draftSignInSlot}
                      />
                      {activeTopupRequest && (
                        <PrivateTopupRequestCard
                          request={activeTopupRequest}
                          model={privateModel}
                          isBusy={isAnsweringTopup}
                          canTopUp={!isTopupActive(privateCredits.flow)}
                          onTopUp={() => void answerTopupRequest(activeTopupRequest.sessionId, activeTopupRequest.requestId, true)}
                          onNotNow={() => void answerTopupRequest(activeTopupRequest.sessionId, activeTopupRequest.requestId, false)}
                        />
                      )}
                      {!activeTopupRequest &&
                        activeSession &&
                        chatTopupSession === activeSession.id &&
                        privateCredits.flow.kind !== "idle" && (
                          <TopupProgress
                            flow={privateCredits.flow}
                            balanceCredits={livePrivateCredits ?? null}
                            onOpenCheckout={privateCredits.openCheckout}
                            onCancel={privateCredits.cancel}
                            onDismiss={() => {
                              privateCredits.dismiss();
                              setChatTopupSession(null);
                            }}
                          />
                        )}
                      <PrivateCreditsOutLayer
                        sessionId={activeSession?.id}
                        reason={creditsOutReason}
                        sessionCap={privateSessionCap}
                        agents={continueAgents.map((agent) => ({ id: agent.id, name: agent.name }))}
                        onOpenSettings={() => settingsPage.open("private")}
                        onContinue={continueWithAgent}
                        onNewSession={handleNewPrivateSession}
                        onRaise={() => void handleRaisePrivateCap()}
                        isRaising={isRaisingPrivateCap}
                        paymentSource={activeIsOwnKey ? "ownKey" : "credits"}
                        ownKeySaved={ownKeySaved}
                        onSwitchToCredits={handleSwitchToCredits}
                        onOpenDashboard={() => openLink("https://cloud.near.ai/")}
                      />
                      {installPanelAgent
                        ? draftInstallSlot
                          ? createPortal(<AgentInstallPanel agent={installPanelAgent} />, draftInstallSlot)
                          : <AgentInstallPanel agent={installPanelAgent} />
                        : null}
                      {privateLowNote !== undefined &&
                        livePrivateCredits !== undefined &&
                        creditsOutNote === undefined &&
                        privateDraft.note === undefined && (
                          <PrivateLowBalanceRow
                            credits={livePrivateCredits}
                            model={privateModel}
                            onTopUp={() => settingsPage.open("private")}
                          />
                        )}
                    </div>
                  </div>
                  {/* 24px at the sides and 20px under it, as the canvas draws the composer's dock. */}
                  {/* A draft's composer sits inside its column, with the agent's sessions right under it. */}
                  {activeSession && (
                    <div hidden={isComposerHidden} className="flex justify-center px-6">
                      <QueuedMessages
                        messages={queue.queueOf(activeSessionId)}
                        agentName={activeAgent?.name ?? "The agent"}
                        hold={isActiveRunning ? queue.holdOf(activeSessionId) : queue.queueOf(activeSessionId).length > 0 ? "ended" : null}
                        announcement={queue.announcementFor(activeSessionId).text}
                        announcementKey={queue.announcementFor(activeSessionId).key}
                        sessionId={activeSessionId}
                        isStarting={acp.isStarting(activeSessionId)}
                        sendNowBlockedReason={
                          (isComposerSendBlocked || (!isActiveRunning && !isResumable)) && queue.queueOf(activeSessionId).length > 0
                            ? (composerNoteText ?? `${activeAgent?.name ?? "The agent"} cannot continue right now.`)
                            : undefined
                        }
                        onFocusComposer={() => composerRef.current?.focus()}
                        onSendNow={(id) => queue.sendNow(activeSessionId, id)}
                        onEdit={(id) => queue.edit(activeSessionId, id)}
                        onRemove={(id) => queue.remove(activeSessionId, id)}
                      />
                    </div>
                  )}
                  <div hidden={isComposerHidden} className={`flex justify-center px-6 ${isNewSessionDraft ? "" : "pb-5"}`}>
                    <ComposerDock
                      controls={compare.isCompare ? {} : composer.controls}
                      isThinking={Boolean(activeSession) && isSessionBusy(activeSessionId)}
                      onStop={activeSession ? () => handleInterrupt(activeSessionId) : undefined}
                      queueing={isQueueingActive}
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
                        isAwaitingAnswer: isAwaitingUser(currentMessages),
                      })}
                      onSendMessage={handleSendMessage}
                      attachAsFiles
                      onAttach={pickFiles}
                      handleRef={composerRef}
                      onTextChange={review.onComposerText}
                      onRestored={review.onComposerRestored}
                      onGivenBack={review.onComposerGivenBack}
                      onNotice={reportError}
                      pasteScope={activeSessionId || "draft"}
                      isHidden={isComposerHidden || settingsPage.section !== null}
                      commands={compare.isCompare ? [] : composerCommands}
                      sendLabel={
                        delegationSendLabel ??
                        (privateDraft.isOn
                          ? "Start private session"
                          : compare.agentIds.length >= 2
                            ? `Start ${compare.agentIds.length} sessions`
                            : undefined)
                      }
                      agentName={activeSession ? activeAgent?.name : newSessionAgent?.name}
                      sessionAgent={activeSession && activeAgent ? { profileId: activeAgent.id, name: activeAgent.name } : undefined}
                      privateDraft={isNewSessionDraft ? privateDraft : undefined}
                      privateSessionLine={privateSessionLine}
                      compareModels={
                        compare.isCompare
                          ? compareModelControls(
                              compare.agentIds.map((id) => ({ id, name: agents.find((a) => a.id === id)?.name ?? id })),
                              state.agentOptions,
                              compareModelProbe.stateOf,
                              {
                                // A pick is the agent's remembered model. For the draft's own agent, its single-draft pick
                                // is dropped too, or it would outrank this one once the agent is alone again.
                                pickModel: (profileId, modelId) => {
                                  rememberModelPick(profileId, modelId);
                                  if (profileId === draftAgent?.id) setAcpChoices(({ modelId: _dropped, ...rest }) => rest);
                                },
                                pickConfig: (profileId, configId, value) => {
                                  rememberPick(profileId, configId, value);
                                  if (profileId === draftAgent?.id) {
                                    setAcpChoices((current) => ({
                                      ...current,
                                      config: Object.fromEntries(Object.entries(current.config).filter(([id]) => id !== configId)),
                                    }));
                                  }
                                },
                              },
                            )
                          : undefined
                      }
                      onOpenCompareModel={compareModelProbe.ask}
                      note={composerNoteText}
                      // Only a compare run's note sits in the row, as drawn; why Send is blocked is a sentence for under the prompt.
                      noteInRow={composerNoteText === COMPARE_NOTE}
                      // While the draft asks its agent what it offers, its chips show as skeletons in the row.
                      isLoadingControls={Boolean(!isActiveRunning && draftAgent && agentCheck.isProbing(draftAgent.id))}
                      aboveCardSlots={draftBlockerSlots}
                      helper={canCompare && !privateDraft.isOn ? DRAFT_COMPARE_HELPER : undefined}
                      contextUsage={isActiveRunning ? acp.info[activeSessionId]?.usage : undefined}
                      onOpenContext={() => inspector.show("context")}
                      mentions={filesFolder ? { root: filesFolder.path, loadFiles: () => shell.loadWorkspaceFiles(filesFolder.path) } : undefined}
                      delegationAgents={delegationAgents}
                      onDelegationMentionChange={setDelegationMention}
                      delegationSummary={delegationSummary}
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
                      agents={
                        isNewSessionDraft && newSessionAgent
                          ? {
                              options: agentChoices,
                              // Outside a repository there is one agent: a press picks it, nothing is ticked.
                              selected: canCompare ? compare.agentIds : [newSessionAgent.id],
                              canTick: canCompare,
                              onChange: compare.toggle,
                              onPick: (agentId) => {
                                compare.reset();
                                setPickedAgentId(agentId);
                              },
                              lockedTo:
                                privateDraft.isOn && privateAgentId !== undefined
                                  ? { agentId: privateAgentId, reason: PRIVATE_DRAFT_TEXT.agentLocked }
                                  : undefined,
                            }
                          : undefined
                      }
                    />
                  </div>
                  {/* After the composer's slot, never around it: the composer keeps its place in the tree, and its text. */}
                  {isNewSessionDraft && <NewSessionBelow sessionList={draftSessionList.sessionList} />}
                </div>
              </article>
              {activeSession && sessionOverview && !activeRun && !isArtifactExpanded && !isDiffOpen && (
                <OverviewCard
                  // Its own folds, floating and preview belong to one session.
                  key={activeSession.id}
                  overview={sessionOverview}
                  agentName={activeAgent?.name ?? "The agent"}
                  changes={isRepository ? diffStats : null}
                  folderName={filesFolder?.name}
                  branch={workspaceDetails?.branch ?? undefined}
                  filesRoot={filesFolder?.path}
                  isCollapsed={overviewCollapse.isCollapsed(activeSession.id)}
                  onToggleCollapsed={() => overviewCollapse.toggle(activeSession.id)}
                  onShowTab={(tab) => inspector.show(tab)}
                  onOpenTask={(tab) => openTask(activeSession.id, tab)}
                  onOpenPage={(artifactId) => {
                    inspector.viewArtifact({ artifactId, version: null });
                    inspector.show("artifacts");
                  }}
                  onOpenFile={(relative) => {
                    inspector.viewFile(relative);
                    inspector.show("files");
                  }}
                  onOpenUrl={openPullRequest}
                />
              )}
              {isArtifactExpanded && activeSession && (
                <section aria-label="Artifact" className="relative flex min-w-0 flex-1 flex-col">
                  <ArtifactsPanel
                    sessionId={activeSession.id}
                    artifacts={sessionArtifacts}
                    viewed={inspector.viewedArtifact}
                    onView={inspector.viewArtifact}
                    isExpanded
                    onToggleExpanded={() => inspector.setArtifactExpanded(false)}
                    onError={reportError}
                    onNotice={setNotice}
                    canvases={sessionCanvases}
                    turnsEnded={turnsEnded}
                    comments={artifactComments}
                    addReview={review.addArtifactReview}
                    cwd={activeSession.cwd}
                    onInsertText={canvasInsertText}
                    insertBlockedReason={canvasInsertBlockedReason}
                  />
                  {/* The chat, which draws the app's notice, is hidden under an expanded page: a failure here
                      (export, rename, delete, a page that cannot be shown) is said here. The page hides under it. */}
                  {settingsPage.section === null && noticeToast && <ToastStack>{noticeToast}</ToastStack>}
                </section>
              )}
              {isDiffOpen && filesFolder && (
                <DiffView
                  key={`${activeSession?.id ?? "draft"}:${filesFolder.path}`}
                  rootPath={filesFolder.path}
                  startCommit={startCommit}
                  prefersStart={Boolean(activeSession?.compareRunId)}
                  review={activeSession ? review.review : undefined}
                  addReview={activeSession ? review.addReview : undefined}
                  version={inspector.changes.version}
                  isExpanded={inspector.isDiffExpanded}
                  onToggleExpanded={inspector.toggleDiffExpanded}
                  onClose={inspector.closeDiff}
                  onError={reportError}
                />
              )}
            </div>
          </div>
          {inspectorTab && !isArtifactExpanded && !isGalleryShown && (
            <Inspector
              tab={inspectorTab}
              tabs={inspectorTabs}
              width={inspector.width}
              maxWidth={maxInspectorWidth(windowWidth, !isSidebarHidden)}
              counts={{ changes: inspector.changes.changes?.length, artifacts: sessionArtifacts.length + createdFiles.length || undefined, tasks: taskTabs.tabs.length || undefined }}
              isViewingFile={inspectorTab === "files" && inspector.viewedFile !== null}
              onSelect={inspector.show}
              onResize={inspector.setWidth}
              onClose={() => {
                inspector.close();
                inspectorButtonRef.current?.focus();
              }}
            >
              {inspectorTab === "changes" && filesFolder && (
                <ChangesPanel
                  key={filesFolder.path}
                  rootPath={filesFolder.path}
                  rootName={filesFolder.name}
                  changes={inspector.changes.changes}
                  version={inspector.changes.version}
                  onReload={inspector.changes.reload}
                  pullRequests={repoPullRequests}
                  onOpenPullRequest={openPullRequest}
                  githubProblem={githubProblem}
                  onOpenGithubSettings={() => settingsPage.open("github")}
                  diffStats={diffStats}
                  onOpenDiff={() => inspector.openDiff()}
                  stats={inspector.headStats ?? undefined}
                  statsFailed={inspector.headStatsFailed}
                  targets={inspector.targets}
                  targetsFailed={inspector.targetsFailed}
                  review={activeSession ? review.review : undefined}
                  addReview={activeSession ? review.addReview : undefined}
                />
              )}
              {inspectorTab === "tasks" && activeSession && (
                <TasksPanel
                  tabs={taskTabs}
                  sessionId={activeSession.id}
                  messages={transcripts[activeSession.id] ?? []}
                  tasks={backgroundTasks.tasks}
                  agentName={activeAgent?.name ?? "The agent"}
                  isBusy={acp.isBusy(activeSession.id)}
                  onStop={backgroundTasks.stop}
                />
              )}
              {inspectorTab === "activity" && activeSession && (
                <ActivityPanel
                  key={activeSession.id}
                  messages={transcripts[activeSession.id]}
                  transcript={transcriptStatus[activeSession.id] ?? "loading"}
                  session={activeSession}
                  isRepository={isRepository}
                  isBusy={isSessionBusy(activeSession.id)}
                  version={inspector.changes.version}
                  headStats={inspector.headStats}
                  headStatsFailed={inspector.headStatsFailed}
                  onJump={(messageId) => setChatJump((prev) => ({ messageId, nonce: (prev?.nonce ?? 0) + 1 }))}
                  agentName={agentNameOr(activeAgent)}
                  onShowChanges={() => inspector.show("changes")}
                />
              )}
              {inspectorTab === "files" && filesFolder && (
                <FilesPanel
                  key={filesFolder.path}
                  rootPath={filesFolder.path}
                  rootName={filesFolder.name}
                  onInsertPath={(path) => insertPaths([path])}
                  onRevealRoot={() => filesFolder && shell.revealFolder(filesFolder.path)}
                  markers={fileMarkers}
                  viewedFile={inspector.viewedFile}
                  onViewFile={inspector.viewFile}
                  onCloseFile={inspector.closeFile}
                  version={inspector.changes.version}
                  filesPrefix={inspector.filesPrefix}
                  // Lines go into the message box only when Reply could: shown, enabled, not holding another session's comments.
                  onInsertText={
                    replyBlockedReason({ isComposerHidden, isComposerDisabled, isHeldElsewhere: review.isHeldFor(activeSessionId) })
                      ? undefined
                      : (text) => composerRef.current?.insertText(text)
                  }
                />
              )}
              {inspectorTab === "context" && activeSession && activeInfo?.usage && (
                <ContextPanel
                  key={activeSession.id}
                  sessionId={activeSession.id}
                  agentId={activeSession.profileId}
                  agentName={activeAgent?.name ?? "The agent"}
                  cwd={activeSession.cwd}
                  usage={activeInfo.usage}
                  turnUsage={activeInfo.turnUsage ?? []}
                  turnsEnded={activeInfo.turnsEnded ?? 0}
                  messages={currentMessages}
                  // An ended session's agent is gone: the command would go to a closed connection.
                  compactCommand={isActiveRunning ? compactCommandOf(activeInfo.commands) : null}
                  isBusy={acp.isBusy(activeSession.id)}
                  onCompact={(command) => sendFromComposer(activeSession.id, { text: `/${command}` })}
                />
              )}
              {inspectorTab === "artifacts" && activeSession && (
                <ArtifactsPanel
                  key={activeSession.id}
                  sessionId={activeSession.id}
                  artifacts={sessionArtifacts}
                  viewed={inspector.viewedArtifact}
                  onView={inspector.viewArtifact}
                  isExpanded={false}
                  onToggleExpanded={() => {
                    // A page that opened by itself is pinned when it takes the chat's place: a file the agent
                    // makes meanwhile would otherwise turn the tab back into a list under the expanded page,
                    // and comments would lose the page they are on.
                    if (!inspector.viewedArtifact && shownArtifact) inspector.viewArtifact({ artifactId: shownArtifact.id, version: null });
                    // So is a canvas that opened by itself, being the only thing listed.
                    const onlyCanvas = sessionCanvases.length === 1 && sessionArtifacts.length === 0 && createdFiles.length === 0 ? sessionCanvases[0] : undefined;
                    if (!inspector.viewedArtifact && onlyCanvas) inspector.viewArtifact({ canvasKey: onlyCanvas.key });
                    inspector.setArtifactExpanded(true);
                  }}
                  onError={reportError}
                  onNotice={setNotice}
                  comments={artifactComments}
                  addReview={review.addArtifactReview}
                  cwd={activeSession.cwd}
                  files={createdFiles}
                  canvases={sessionCanvases}
                  turnsEnded={turnsEnded}
                  onInsertText={canvasInsertText}
                  insertBlockedReason={canvasInsertBlockedReason}
                  filesRoot={filesFolder?.path}
                  agentName={activeAgent?.name}
                  onOpenFile={(relative) => {
                    inspector.viewFile(relative);
                    inspector.show("files");
                  }}
                />
              )}
              {inspectorTab === "private" && activeSession?.privateMode && (
                <PrivateInspector
                  session={activeSession}
                  credits={privateCredits}
                  messages={currentMessages}
                  onTopUp={() => settingsPage.open("private")}
                  onOpenUrl={openLink}
                />
              )}
              {inspectorTab === "browser" && activeSession && <BrowserPanel
                key={activeSession.id}
                sessionId={activeSession.id}
                onError={reportError}
                onAddContext={replyBlockedReason({ isComposerHidden, isComposerDisabled, isHeldElsewhere: review.isHeldFor(activeSessionId) })
                  ? undefined
                  : (text) => {
                    if (activeSessionIdRef.current === activeSession.id) composerRef.current?.insertText(text);
                  }}
              />}
              {inspectorTab === "terminal" && filesFolder && (
                <TerminalDrawer
                  folderPath={filesFolder.path}
                  folderName={filesFolder.name}
                  terminals={terminals}
                  startingFor={terminalDrawer.startingFor}
                  onStartShell={terminalDrawer.startShell}
                />
              )}
            </Inspector>
          )}
        </div>
      </section>
      <BrowserPermissionLayer request={browserAgentTools.request} busy={browserAgentTools.answering} answer={browserAgentTools.answer} />
      <SettingsPage
        page={settingsPage}
        persisted={{ state, updateState }}
        agents={agents}
        refreshAgents={refreshAgents}
        catalog={agentCatalog}
        actions={catalogActions}
        updateCount={agentUpdates.updateCount}
        recentFolders={workspaces}
        onRemoveRecentFolder={removeFolder}
        onRunOnboarding={handleRunOnboarding}
        appVersion={userProfile.version}
        appUpdate={appUpdate}
        restartNote={restartWarning(busyCount, terminals.liveCount) || null}
        notice={settingsPage.section !== null && noticeToast}
        github={github}
        agentSignIn={settingsSignIn}
        privateCredits={privateCredits}
        onShowRecoveryCode={recoveryDialog.show}
        onRestoringChange={recoveryDialog.setIsRestoring}
        onOpenUrl={openLink}
        // Development builds only until agents get the computer-use tools (the plan's Tasks 9 to 12):
        // a release must not ship a switch that asks macOS for permissions and then does nothing.
        computerUse={computerUseSetting}
      />
      <RecoveryCodeLayer
        credits={privateCredits}
        request={recoveryDialog.request}
        suppressStatusPrompt={recoveryDialog.suppressStatusPrompt}
        onClose={recoveryDialog.close}
      />
      {secretGuard.review && (
        <SecretGuardDialog
          review={secretGuard.review}
          onSendAnyway={secretGuard.sendAnyway}
          onEdit={secretGuard.edit}
        />
      )}
      {delegateDialog.dialog !== null && (
        <DelegateDialog
          agents={delegateAgents}
          sourceAgentName={activeAgent?.name ?? "The agent"}
          isSourceRunning={isActiveRunning}
          initialAgentId={delegateDialog.dialog.initialAgentId}
          initialTask={delegateDialog.dialog.initialTask}
          controlsFor={delegateDialog.controlsFor}
          onDelegate={delegateDialog.delegate}
          onCancel={delegateDialog.close}
        />
      )}
    </main>
  );
}
