import { describe, it, expect } from 'vitest';
import { COMMAND_PATH_CONTEXT, withToolsContext } from '../lib/agent-tools-context';

const TOOLS = ['list_agents', 'delegate', 'start_session', 'read_session', 'stop_session'];

describe('the command path context', () => {
  it('stays under 700 characters and quotes the variable', () => {
    expect(COMMAND_PATH_CONTEXT.length).toBeLessThanOrEqual(700);
    expect(COMMAND_PATH_CONTEXT).toContain('"$ZORVO_TOOLS" tools');
    expect(COMMAND_PATH_CONTEXT).not.toContain('\n');
  });

  it('names only tools the backend lists', () => {
    const named = COMMAND_PATH_CONTEXT.match(/\b[a-z]+_[a-z]+\b/g) ?? [];
    expect(named.length).toBeGreaterThan(0);
    for (const word of named) expect(TOOLS).toContain(word);
  });

  it('is the whole context when there is no other', () => {
    expect(withToolsContext(undefined)).toBe(COMMAND_PATH_CONTEXT);
    expect(withToolsContext('')).toBe(COMMAND_PATH_CONTEXT);
  });

  it('puts the tools context before an existing context', () => {
    expect(withToolsContext('Read the file "/tmp/handoff.md".')).toBe(
      `${COMMAND_PATH_CONTEXT}\n\nRead the file "/tmp/handoff.md".`,
    );
  });
});
