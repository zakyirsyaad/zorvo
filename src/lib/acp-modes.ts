import type { AcpOptions } from '../hooks/useAcpSessions';
import { isRiskyMode } from './composer-controls';

/**
 * Mode ids that mean "ask before acting", in order of preference. Codex's
 * `workspace-write` comes before `read-only`: it is the nearest step down from
 * its full-access mode, where `read-only` would stop the agent from editing.
 */
const SAFE_MODE_IDS = ['default', 'manual', 'ask', 'workspace-write', 'read-only'];

export type SafeModeChange =
  | { kind: 'mode'; modeId: string }
  | { kind: 'config'; configId: string; value: string };

function safeIdAmong(current: string, currentName: string | undefined, available: readonly string[]): string | undefined {
  if (!isRiskyMode(current, currentName)) return undefined;
  const offered = new Set(available);
  return SAFE_MODE_IDS.find((id) => offered.has(id));
}

/**
 * The change that puts a freshly started session in a safe mode, or
 * undefined to leave it as it is.
 *
 * An agent can start in whatever mode the user configured for it elsewhere
 * (Qwen Code in YOLO, for example). The app's default is to ask before
 * acting, so a risky starting mode is switched to the agent's safe one when
 * the agent offers it, whether it reports modes or a "mode" config option.
 * The user can still pick the risky mode in the composer.
 *
 * Codex starts in `agent` ("Auto review"): its own reviewer approves actions,
 * which is not a bypass, so it is left as it is (pinned in acp-modes.test.ts).
 * Switching it would override a choice the user made in Codex, so do not add
 * it to the risky modes without asking the maintainer.
 */
export function safeModeToApply(info: AcpOptions): SafeModeChange | undefined {
  if (info.modes) {
    const { currentModeId, availableModes } = info.modes;
    const modeId = safeIdAmong(
      currentModeId,
      availableModes.find((m) => m.id === currentModeId)?.name,
      availableModes.map((m) => m.id),
    );
    return modeId ? { kind: 'mode', modeId } : undefined;
  }
  const option = info.configOptions.find((o) => o.category === 'mode');
  if (!option) return undefined;
  const value = safeIdAmong(
    option.currentValue,
    option.options.find((o) => o.value === option.currentValue)?.name,
    option.options.map((o) => o.value),
  );
  return value ? { kind: 'config', configId: option.id, value } : undefined;
}
