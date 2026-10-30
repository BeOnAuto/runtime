import { describe, expect, it } from 'vitest';

import type { InstanceSource } from '../instances/instance-source.ts';
import { sourcesUnderTest } from '../pool-testing/test-pools.ts';
import { moduleRun, type ModuleRequest } from './module-runs.ts';
import { threadStackBytes, unitMemoryBytes } from './sandbox-bounds.ts';

const syntaxError: unknown = expect.stringContaining('SyntaxError');

const settings = { stackBytes: threadStackBytes, mostAnswerBytes: 1_048_576, clock: () => 0 };

function requestOf(source: string, more: Partial<ModuleRequest> = {}): ModuleRequest {
  return {
    source,
    entry: 'default',
    arguments: ['{"name":"Ada"}'],
    evaluation: { budget: 500, deadlineAt: Number.POSITIVE_INFINITY, moment: 0 },
    ...more,
  };
}

async function ran(source: InstanceSource, program: string, more: Partial<ModuleRequest> = {}): Promise<unknown> {
  return moduleRun(await source(unitMemoryBytes), settings, requestOf(program, more));
}

describe.each(sourcesUnderTest)('a run of a module on $name instances', ({ source }) => {
  it('calls the function its entry names with its arguments and answers its value as JSON', async () => {
    const program =
      'export default function (input) {\n  return `Hello, ${input.name}`;\n}\nexport function shout(text) {\n  return text.toUpperCase();\n}';

    expect(await ran(source, program)).toEqual({ ran: 'answered', text: '"Hello, Ada"', work: 0 });
    expect(await ran(source, program, { entry: 'shout', arguments: ['"quiet"'] })).toEqual({
      ran: 'answered',
      text: '"QUIET"',
      work: 0,
    });
  });

  it('refuses a module that does not load, as JavaScript the check would not have stripped, or that exports no function of its entry', async () => {
    expect(await ran(source, 'export default function (): number {\n  return 1;\n}')).toMatchObject({
      ran: 'refused',
      issue: { detail: syntaxError, line: 1 },
    });
    expect(await ran(source, 'export default function () {\n  return 1 +;\n}')).toMatchObject({
      ran: 'refused',
      issue: { detail: "SyntaxError: unexpected token in expression: ';'", line: 2 },
    });
    expect(
      await ran(source, 'throw new Error("not now");\nexport default function () {\n  return 1;\n}'),
    ).toMatchObject({
      ran: 'refused',
      issue: { detail: 'Error: not now', line: 1 },
    });
    expect(await ran(source, 'export const answer = 42;')).toEqual({
      ran: 'refused',
      issue: { detail: 'The program exports no function default', line: null },
    });
  });

  it('ends a module whose loading does more work than its budget allows, as a run that ran out of it', async () => {
    expect(await ran(source, 'for (;;) {}\nexport default function () {\n  return 1;\n}')).toMatchObject({
      ran: 'exhausted',
      limit: 'work',
    });
  });
});
