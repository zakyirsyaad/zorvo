import { invoke } from '@tauri-apps/api/core';
import type { ChatMessage } from '../types';

export interface ConversationMarkdownMeta {
  sessionName: string;
  agentName: string;
  cwd?: string;
  exportedAt?: number;
}

const MAX_SLUG_LENGTH = 60;

/** Safe `.md` filename derived from a session's title. */
export function conversationFileName(sessionName: string): string {
  const slug = sessionName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
  return `${slug || 'conversation'}.md`;
}

function hasExportableContent(message: ChatMessage): boolean {
  if (message.role === 'user') return true;
  return Boolean(
    message.content.trim() ||
      message.tools?.length ||
      message.actionCard ||
      message.artifactCard ||
      message.parts?.some((part) => part.kind === 'visual'),
  );
}

function headingFor(message: ChatMessage, agentName: string): string {
  if (message.role === 'agent') return `## ${agentName}`;
  if (message.delegationReport) {
    const handle = message.delegationReport.handle ? ` (${message.delegationReport.handle})` : '';
    return `## From ${message.delegationReport.agentName}${handle}`;
  }
  if (message.workerReport) return '## Worker reports';
  if (message.delegationTask) return `## Task from ${message.delegationTask.agentName}`;
  return '## You';
}

function formatMessage(message: ChatMessage, agentName: string): string {
  const blocks: string[] = [headingFor(message, agentName)];

  if (message.attachments?.length) {
    blocks.push(message.attachments.map((path) => `- Attached: \`${path}\``).join('\n'));
  }

  const trimmed = message.content.trim();
  if (trimmed) {
    blocks.push(trimmed);
  }

  const topTools = (message.tools ?? []).filter((tool) => tool.parentId === undefined);
  if (topTools.length > 0) {
    blocks.push(`- Tools: ${topTools.map((tool) => tool.name).join(', ')}`);
  }

  const visuals = (message.parts ?? []).filter(
    (part): part is Extract<NonNullable<ChatMessage['parts']>[number], { kind: 'visual' }> => part.kind === 'visual',
  );
  if (visuals.length > 0) {
    blocks.push(visuals.map((visual) => `- Visual: ${visual.title}`).join('\n'));
  }

  if (message.artifactCard) {
    blocks.push(`- Artifact: ${message.artifactCard.title}`);
  }

  if (message.actionCard) {
    blocks.push(`- Approval: ${message.actionCard.prompt} (${message.actionCard.status})`);
  }

  return blocks.join('\n\n');
}

/** Formats a session's messages into a clean Markdown document for copying or exporting. */
export function formatConversationMarkdown(
  messages: readonly ChatMessage[],
  meta: ConversationMarkdownMeta,
): string {
  const headerLines = [
    `# ${meta.sessionName}`,
    '',
    `- Agent: ${meta.agentName}`,
    ...(meta.cwd ? [`- Folder: ${meta.cwd}`] : []),
    `- Exported: ${new Date(meta.exportedAt ?? Date.now()).toISOString()}`,
  ];

  const body = messages
    .filter(hasExportableContent)
    .map((message) => formatMessage(message, meta.agentName));

  return `${[headerLines.join('\n'), ...body].join('\n\n')}\n`;
}

/** Opens the native save dialog and writes the Markdown document to disk. */
export function exportConversationMarkdown(suggestedName: string, content: string): Promise<boolean> {
  return invoke<boolean>('export_conversation_markdown', { suggestedName, content });
}
