import { describe, expect, it } from 'vitest';

import type { Command } from '../testing/machine-host.ts';
import { interpret, workflow } from '../testing/workflows.ts';

function nestedDo(levels: number): string {
  return levels === 1 ? '[{ leaf: { set: { done: true } } }]' : `[{ inner: { do: ${nestedDo(levels - 1)} } }]`;
}

function commandsBesidesTheDeadline(commands: readonly Command[]): readonly Command['kind'][] {
  return commands.map(({ kind }) => kind).filter((kind) => kind !== 'deadline');
}

function branches(count: number): string {
  return Array.from({ length: count }, (_, index) => `{ b${index}: { set: { n: ${index} } } }`).join(', ');
}

describe('a workflow that starts with tasks nested too deeply', () => {
  it('is rejected before it runs any of them, however it was stored', async () => {
    const { settlement, commands } = await interpret(workflow(`do: ${nestedDo(65)}`));

    expect(settlement).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
    expect(commandsBesidesTheDeadline(commands)).toStrictEqual(['settle']);
  });
});

describe('a workflow that starts with a fork of more than 32 branches', () => {
  it('is rejected before it runs any of them', async () => {
    const { settlement, commands } = await interpret(
      workflow(`do:\n  - wide: { fork: { branches: [${branches(33)}] } }`),
    );

    expect(settlement).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
    expect(commandsBesidesTheDeadline(commands)).toStrictEqual(['settle']);
  });
});
