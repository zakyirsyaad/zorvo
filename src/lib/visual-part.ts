import type { ChatMessage } from '../types';
import { partsOf, withOpenReply, type AcpReducerContext } from './acp-events';
import type { VisualEntry } from './visuals';

/**
 * Marks in the chat where the agent showed a visual: a part of its open reply, after what the
 * reply already holds, so text, visual, text read in the order they arrived.
 */
export function withVisualPart(messages: readonly ChatMessage[], entry: VisualEntry, ctx: AcpReducerContext): ChatMessage[] {
  return withOpenReply(messages, ctx, (reply) => ({
    ...reply,
    parts: [...partsOf(reply), { kind: 'visual', id: entry.id, title: entry.title, visualKind: entry.kind }],
  }));
}
