// Global test setup for Vitest (JSDOM environment mocks)

import { afterEach } from "vitest";
import { configure } from "@testing-library/react";
import { fakeProfiles } from "./fixtures/agents";
import { fakeCatalog } from "./fixtures/catalog";
import { handlePrivateCommand, resetFakePrivate } from "./fixtures/private-backend";

// App tests wait for real state; under the pre-push hook's load a query can take
// longer than Testing Library's 1 s default. A passing test still ends as soon
// as the condition is met, so only a slow or stuck one waits this long.
configure({ asyncUtilTimeout: 10_000 });

/**
 * In-memory stand-in for the backend store commands. Tests seed it through
 * `window.__FAKE_TAURI_STORE__` and it is reset after every test.
 */
export interface FakeTauriStore {
  state: {
    version: number;
    settings: {
      defaultAgentId: string | null;
      onboardingCompleted: boolean;
      secretGuard?: boolean;
      paymentSource?: 'credits' | 'ownKey';
    };
    recentFolders: unknown[];
    sessions: unknown[];
    agentOptions?: Record<string, unknown>;
  };
  transcripts: Record<string, unknown[]>;
}

/**
 * Default: a returning user who finished onboarding and has three recent
 * folders (newest first). Onboarding tests flip `onboardingCompleted` back.
 */
function emptyFakeStore(): FakeTauriStore {
  return {
    state: {
      version: 2,
      settings: { defaultAgentId: null, onboardingCompleted: true },
      recentFolders: [
        { name: "ai-perpetual-trading", path: "/Users/test/developer/ai-perpetual-trading", lastOpenedAt: 3000 },
        { name: "titan-investment", path: "/Users/test/developer/titan-investment", lastOpenedAt: 2000 },
        { name: "zorvo", path: "/Users/test/developer/zorvo", lastOpenedAt: 1000 },
      ],
      sessions: [],
    },
    transcripts: {},
  };
}

type StoreArgs = { state?: FakeTauriStore["state"]; sessionId?: string; messages?: unknown[] };

function handleStoreCommand(cmd: string, args: StoreArgs | undefined): Promise<unknown> | null {
  const store = (window as unknown as { __FAKE_TAURI_STORE__: FakeTauriStore }).__FAKE_TAURI_STORE__;
  switch (cmd) {
    case "load_app_state":
      return Promise.resolve(structuredClone(store.state));
    case "save_app_state":
      store.state = structuredClone(args?.state ?? store.state);
      return Promise.resolve(undefined);
    case "load_transcript":
      return Promise.resolve(structuredClone(store.transcripts[args?.sessionId ?? ""] ?? []));
    case "save_transcript":
      store.transcripts[args?.sessionId ?? ""] = structuredClone(args?.messages ?? []);
      // The backend answers with the bytes it wrote.
      return Promise.resolve(JSON.stringify(args?.messages ?? []).length);
    case "delete_transcript":
      delete store.transcripts[args?.sessionId ?? ""];
      return Promise.resolve(undefined);
    case "acp_start_session":
    case "acp_fork_session":
    case "acp_reopen_session":
    case "acp_import_session":
      // Shaped like Qwen Code's real answer; it starts in YOLO like the user's own config.
      return Promise.resolve({
        // A test sets this to open sessions on a tools path ("mcp" or "command").
        toolsPath: (window as unknown as { __FAKE_TOOLS_PATH__?: string }).__FAKE_TOOLS_PATH__,
        acpSessionId:
          (args as { acpSessionId?: string })?.acpSessionId ?? `acp-${(args as { sessionId?: string })?.sessionId}`,
        agentCapabilities: { sessionCapabilities: { fork: {} } },
        modes: {
          currentModeId: "yolo",
          availableModes: [
            { id: "default", name: "Default" },
            { id: "yolo", name: "YOLO" },
          ],
        },
        models: null,
        configOptions: [],
      });
    case "acp_list_sessions": {
      const fake = (window as unknown as { __FAKE_ACP_LIST__?: unknown }).__FAKE_ACP_LIST__;
      return Promise.resolve(structuredClone(fake ?? { sessions: [], truncated: false, incomplete: false }));
    }
    case "acp_set_config_option":
      return Promise.resolve([]);
    case "acp_cancel":
      return Promise.resolve([]);
    case "acp_qwen_last_api_error":
      return Promise.resolve(null);
    case "acp_prompt":
    case "acp_respond_permission":
    case "acp_respond_elicitation":
    case "acp_reopen_elicitation_url":
    case "acp_set_mode":
    case "acp_set_model":
    case "acp_stop_session":
      return Promise.resolve(undefined);
    case "write_fork_handoff":
      return Promise.resolve(`/fake/app-data/handoffs/${(args as { handoffId?: string })?.handoffId}.md`);
    case "get_user_profile":
      return Promise.resolve({ name: "Test User", email: "test@example.com" });
    case "plugin:app|version":
      return Promise.resolve("0.1.0");
    case "read_workspace_file":
      return Promise.resolve({ kind: "text", text: "", size: 0 });
    case "list_directory":
    case "background_processes":
      return Promise.resolve([]);
    case "agent_tool_respond":
    case "open_path":
    case "remember_workspace":
    case "end_orphaned_sessions":
    case "open_external_url":
    case "open_session_window":
    case "reveal_in_finder":
    case "terminate_session":
    case "send_input":
    case "resize_session":
    case "install_agent":
      return Promise.resolve(undefined);
    case "cancel_agent_install":
      return Promise.resolve(false);
    default:
      return null;
  }
}

/**
 * A desktop window's width. jsdom's default (1024) is narrower than the sidebar,
 * the inspector and the chat together, so every open inspector would hide the sidebar.
 */
const DESKTOP_WIDTH = 1440;

function setDesktopWidth() {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: DESKTOP_WIDTH });
}

if (typeof window !== "undefined") {
  (window as unknown as { __FAKE_TAURI_STORE__: FakeTauriStore }).__FAKE_TAURI_STORE__ = emptyFakeStore();
  setDesktopWidth();
  resetFakePrivate();
  afterEach(async () => {
    setDesktopWidth();
    // Imported here, not at the top: a static import would load the module before a test file's vi.mock applies.
    (await import("../lib/agent-icons")).resetAgentIcons();
    (await import("../lib/attachment-previews")).clearAttachmentPreviews();
    (window as unknown as { __FAKE_TAURI_STORE__: FakeTauriStore }).__FAKE_TAURI_STORE__ = emptyFakeStore();
    delete (window as unknown as { __FAKE_ACP_LIST__?: unknown }).__FAKE_ACP_LIST__;
    resetFakePrivate();
  });
}

/** Tauri's asset URL for a file, as the macOS webview builds it with `convertFileSrc`. */
export function fakeConvertFileSrc(filePath: string, protocol = "asset"): string {
  return `${protocol}://localhost/${encodeURIComponent(filePath)}`;
}

/**
 * The fake Tauri backend every test runs against. A test that spies on
 * `invoke` and passes the other commands through calls this, never the
 * `invoke` it read before spying: that may already be a spy, and Vitest
 * hands back the same spy, so calling it would recurse.
 */

export function fakeTauriInvoke(cmd: string, args?: unknown): Promise<unknown> {
  const storeResult = handleStoreCommand(cmd, args as StoreArgs | undefined);
  if (storeResult) {
    return storeResult;
  }
  const privateResult = handlePrivateCommand(cmd, args);
  if (privateResult) {
    return privateResult;
  }
  if (cmd === "list_workspaces") {
    return Promise.resolve([
      { name: "ai-perpetual-trading", path: "/Users/test/developer/ai-perpetual-trading" },
      { name: "titan-investment", path: "/Users/test/developer/titan-investment" },
      { name: "zorvo", path: "/Users/test/developer/zorvo" },
    ]);
  }
  if (cmd === "get_agent_profiles") {
    return Promise.resolve(structuredClone(fakeProfiles));
  }
  if (cmd === "get_agent_catalog") {
    return Promise.resolve({ lastChecked: null, agents: structuredClone(fakeCatalog), unavailable: [] });
  }
  if (cmd === "get_agent_icons") {
    return Promise.resolve({});
  }
  if (cmd === "update_agent") {
    const agentId = (args as { agentId?: string } | undefined)?.agentId;
    return Promise.resolve(fakeCatalog.find((a) => a.id === agentId)?.updateVersion ?? null);
  }
  if (cmd === "session_diff_stats_since") {
    return Promise.resolve([]);
  }
  if (cmd === "session_diff_targets") {
    return Promise.resolve({ base: null, root: (args as { path: string }).path, prefix: "" });
  }
  if (cmd === "session_file_diff") {
    // A read `since` a commit differs from the plain HEAD one, so a test can tell which it got.
    const { since } = args as { since?: string };
    return Promise.resolve(since ? `@@ -1 +1 @@\n-before\n+changed since ${since}\n` : "");
  }
  if (cmd === "remove_agent_install") {
    return Promise.resolve(undefined);
  }
  if (cmd === "workspace_details") {
    return Promise.resolve({ location: "~/developer", branch: "main" });
  }
  if (cmd === "worktree_attachment_paths") {
    return Promise.resolve((args as { paths: string[] }).paths);
  }
  if (cmd === "attachment_preview") {
    return Promise.resolve(undefined);
  }
  return Promise.resolve(undefined);
}

if (typeof window !== "undefined") {
  // Provide mock for Tauri invoke and event system if not running in real Tauri webview
  let nextCallbackId = 1;
  const win = window as unknown as {
    __TAURI_INTERNALS__?: {
      invoke: (cmd: string, args?: unknown) => Promise<unknown>;
      convertFileSrc?: (filePath: string, protocol?: string) => string;
      transformCallback?: (callback: unknown, once?: boolean) => number;
      unregisterCallbackAction?: (id: number) => void;
    };
    __TAURI_EVENT_PLUGIN_INTERNALS__?: {
      unregisterListener: (event: string, eventId: number) => void;
    };
  };

  if (!win.__TAURI_INTERNALS__) {
    win.__TAURI_INTERNALS__ = {
      invoke: fakeTauriInvoke,
      convertFileSrc: fakeConvertFileSrc,
      transformCallback: (_cb: unknown, _once?: boolean) => nextCallbackId++,
      unregisterCallbackAction: (_id: number) => {},
    };
  }

  if (!win.__TAURI_EVENT_PLUGIN_INTERNALS__) {
    win.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (_event: string, _eventId: number) => {},
    };
  }

  window.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(cb, 0) as unknown as number;
  window.cancelAnimationFrame = (id: number) => clearTimeout(id);

  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  HTMLCanvasElement.prototype.getContext = (() => ({
    fillRect: () => {},
    clearRect: () => {},
    getImageData: () => ({ data: new Array(4) }),
    putImageData: () => {},
    createImageData: () => [],
    setTransform: () => {},
    drawImage: () => {},
    save: () => {},
    fillText: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    stroke: () => {},
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    arc: () => {},
    fill: () => {},
    measureText: () => ({ width: 10 }),
    transform: () => {},
    rect: () => {},
    clip: () => {},
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

  if (typeof ResizeObserver === "undefined") {
    class MockResizeObserver {
      callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      observe = () => {};
      unobserve = () => {};
      disconnect = () => {};
    }
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  }
}
