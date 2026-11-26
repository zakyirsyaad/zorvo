import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  conversationFileName,
  exportConversationMarkdown,
  formatConversationMarkdown,
} from '../lib/conversation-markdown';
import type { ChatMessage } from '../types';

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const tauriInternals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('conversationFileName', () => {
  it('slugifies session titles, caps length, and falls back to conversation.md', () => {
    expect(conversationFileName('Fix login bug #42!')).toBe('fix-login-bug-42.md');
    expect(conversationFileName('   ---   ')).toBe('conversation.md');
    const long = conversationFileName('a '.repeat(50));
    expect(long.endsWith('.md')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(63);
  });
});

describe('formatConversationMarkdown', () => {
  it('formats metadata, user/agent turns, attachments, tools, visuals, artifacts, and skips empty agent replies', () => {
    const messages: ChatMessage[] = [
      {
        id: 'm1',
        role: 'user',
        content: 'Please fix the header.',
        attachments: ['src/App.tsx'],
        timestamp: 1000,
      },
      {
        id: 'm-empty',
        role: 'agent',
        content: '   ',
        timestamp: 1500,
      },
      {
        id: 'm2',
        role: 'agent',
        content: 'Updated the header component.',
        timestamp: 2000,
        tools: [
          { id: 't1', name: 'read_file', status: 'completed' },
          { id: 't2', name: 'sub_tool', status: 'completed', parentId: 't1' },
          { id: 't3', name: 'edit_file', status: 'completed' },
        ],
        parts: [{ kind: 'visual', id: 'v1', title: 'Header layout', visualKind: 'svg' }],
        artifactCard: { artifactId: 'a1', title: 'Design spec', version: 1 },
      },
      {
        id: 'm3',
        role: 'user',
        content: 'Worker finished tests.',
        timestamp: 3000,
        delegationReport: { agentName: 'Codex', handle: 'worker-1' },
      },
    ];

    const md = formatConversationMarkdown(messages, {
      sessionName: 'Fix header',
      agentName: 'Claude Code',
      cwd: '/w/app',
      exportedAt: Date.UTC(2026, 10, 26, 2, 0, 0),
    });

    expect(md).toContain('# Fix header\n\n- Agent: Claude Code\n- Folder: /w/app\n- Exported: 2026-11-26T02:00:00.000Z');
    expect(md).toContain('## You\n\n- Attached: `src/App.tsx`\n\nPlease fix the header.');
    expect(md).toContain('## Claude Code\n\nUpdated the header component.\n\n- Tools: read_file, edit_file\n\n- Visual: Header layout\n\n- Artifact: Design spec');
    expect(md).toContain('## From Codex (worker-1)\n\nWorker finished tests.');
    expect(md).not.toContain('sub_tool');
    expect(md.endsWith('\n')).toBe(true);
  });
});

describe('exportConversationMarkdown', () => {
  it('invokes export_conversation_markdown with suggestedName and content', async () => {
    const spy = vi.spyOn(tauriInternals(), 'invoke').mockResolvedValueOnce(true);
    const saved = await exportConversationMarkdown('fix-header.md', '# Fix header\n');
    expect(saved).toBe(true);
    expect(spy).toHaveBeenCalledWith(
      'export_conversation_markdown',
      { suggestedName: 'fix-header.md', content: '# Fix header\n' },
      undefined,
    );
  });
});
