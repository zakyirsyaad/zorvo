import { invoke } from '@tauri-apps/api/core';

/**
 * The last API error Qwen Code logged since the turn began, as "<status> <message>".
 * Qwen reports a failed request over ACP without its error; the backend reads it
 * from Qwen's own log. Without the turn's start nothing is looked up, so an older
 * turn's error is never shown as this one's.
 */
export async function qwenErrorDetail(sessionId: string, since: number | undefined): Promise<string | undefined> {
  if (since === undefined) return undefined;
  try {
    const error = await invoke<{ statusCode?: number | null; message: string } | null>('acp_qwen_last_api_error', {
      sessionId,
      since,
    });
    if (!error?.message) return undefined;
    return error.statusCode ? `${error.statusCode} ${error.message}` : error.message;
  } catch {
    // Best effort: the notice still says how many requests failed, only without the error text.
    return undefined;
  }
}
