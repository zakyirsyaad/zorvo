import type { ArtifactCard, ChatMessage } from '../types';
import { openReplyIndex, withOpenReply, type AcpReducerContext } from './acp-events';
import type { ShownArtifact } from './artifacts';
import { artboardCount, type CanvasRead } from './canvas';
import type { MotionRead, VideoEntry } from './motion';

/**
 * Marks in the chat where the agent showed a page: on its open reply, or on a
 * new agent message when that reply already carries a card, so each version
 * shown keeps a row of its own.
 */
export function withArtifactCard(messages: ChatMessage[], shown: ShownArtifact, ctx: AcpReducerContext): ChatMessage[] {
  return withCard(messages, { artifactId: shown.artifact.id, title: shown.artifact.title, version: shown.version }, ctx);
}

/** Marks in the chat where the agent showed a canvas, with its title and artboard count then. */
export function withCanvasCard(messages: ChatMessage[], read: CanvasRead, ctx: AcpReducerContext): ChatMessage[] {
  const title = read.canvas?.title ?? read.entry.title;
  const artboards = read.canvas ? artboardCount(read.canvas) : read.entry.artboards;
  return withCard(messages, { kind: 'canvas', canvasKey: read.entry.key, title, artboards }, ctx);
}

/** Marks in the chat where the agent showed a motion, with its length and format count then. */
export function withMotionCard(messages: ChatMessage[], read: MotionRead, ctx: AcpReducerContext): ChatMessage[] {
  return withCard(messages, { kind: 'motion', motionKey: read.entry.key, title: read.title, duration: read.duration, formats: read.formats.length }, ctx);
}

/** Marks in the chat where the agent showed a video file. */
export function withVideoCard(messages: ChatMessage[], entry: VideoEntry, ctx: AcpReducerContext): ChatMessage[] {
  return withCard(messages, { kind: 'video', videoKey: entry.key, title: entry.title }, ctx);
}

function withCard(messages: ChatMessage[], card: ArtifactCard, ctx: AcpReducerContext): ChatMessage[] {
  const open = messages[openReplyIndex(messages)];
  if (open?.artifactCard) {
    return [...messages, { id: ctx.createId('msg'), role: 'agent', content: '', timestamp: ctx.now, artifactCard: card }];
  }
  return withOpenReply(messages, ctx, (reply) => ({ ...reply, artifactCard: card }));
}
