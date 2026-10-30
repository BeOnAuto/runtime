import { describe, expect, it } from 'vitest';

import type { Command } from '../testing/machine-host.ts';
import { interpret, neverAnswers, workflow } from '../testing/workflows.ts';

function timersAndCalls(commands: readonly Command[]): readonly string[] {
  return commands.flatMap(({ kind }) => (kind === 'timer' || kind === 'call' ? [kind] : []));
}

describe('a task timeout', () => {
  it('cancels the task and raises a timeout error when the task runs longer', async () => {
    const document = workflow(`
do:
  - slow:
      call: run_definition
      with: { type: reasoning, name: lookup }
      timeout: { after: PT30S }
`);

    const { settlement, commands } = await interpret(document, { respond: neverAnswers });

    expect(settlement).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'The task did not finish within 30000 ms, at the step slow.',
    });
    expect(commands).toContainEqual({ kind: 'cancelled', summary: '/do/0/slow' });
  });

  it('is cancelled itself when the task finishes in time', async () => {
    const document = workflow(`
do:
  - quick:
      wait: PT1S
      timeout: { after: PT30S }
`);

    const { ending, commands } = await interpret(document);

    expect(ending.kind).toBe('completed');
    expect(commands).toContainEqual({ kind: 'cancelled', summary: '/do/0/quick timeout' });
  });
});

describe('the timer of a timeout', () => {
  it('starts before the task it times', async () => {
    const document = workflow(`
do:
  - slow:
      call: run_definition
      with: { type: reasoning, name: lookup }
      timeout: { after: PT30S }
`);

    const { commands } = await interpret(document);

    expect(timersAndCalls(commands)).toStrictEqual(['timer', 'call']);
  });
});

describe('a timeout the document reuses or computes', () => {
  it('is read from use.timeouts', async () => {
    const document = workflow(`
use:
  timeouts:
    brief: { after: PT2S }
do:
  - slow: { wait: PT1M, timeout: brief }
`);

    expect((await interpret(document)).settlement).toMatchObject({
      detail: 'The task did not finish within 2000 ms, at the step slow.',
    });
  });

  it('is computed by an expression', async () => {
    const document = workflow(`
do:
  - slow: { wait: PT1M, timeout: { after: '\${ $data.limit }' } }
`);

    expect((await interpret(document, { input: { limit: 'PT3S' } })).settlement).toMatchObject({
      detail: 'The task did not finish within 3000 ms, at the step slow.',
    });
  });

  it('raises a configuration error when it is not a duration or not there', async () => {
    const computed = workflow("do:\n  - slow: { wait: PT1M, timeout: { after: '${ $data.limit }' } }");
    const missing = workflow('do:\n  - slow: { wait: PT1M, timeout: nowhere }');

    expect((await interpret(computed, { input: { limit: 'soon' } })).settlement).toMatchObject({
      detail: 'A duration of the task is not valid: soon is not an ISO 8601 duration, at the step slow.',
    });
    expect((await interpret(missing)).settlement).toMatchObject({
      detail: 'use.timeouts has no timeout nowhere, at the step slow.',
    });
  });
});

describe('a workflow timeout', () => {
  it('cancels the whole workflow and raises a timeout error', async () => {
    const document = workflow(`
timeout: { after: PT10S }
do:
  - first: { wait: PT5S }
  - second: { wait: PT1H }
`);

    expect((await interpret(document)).settlement).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'The task did not finish within 10000 ms.',
    });
  });

  it('raises a configuration error when it has no duration', async () => {
    expect((await interpret(workflow('timeout: {}\ndo: []'))).settlement).toMatchObject({
      detail: 'A duration of the task is not valid: A duration is an ISO 8601 string or an object of units.',
    });
  });
});

describe('a wait', () => {
  it('waits the duration it is given, written in any form', async () => {
    const document = workflow(`
do:
  - iso: { wait: PT1S }
  - units: { wait: { seconds: 2 } }
  - computed: { wait: '\${ $data.pause }' }
`);

    const { fake } = await interpret(document, { input: { pause: 'PT3S' } });

    expect(fake.now() - Date.parse('2026-10-01T09:00:00.000Z')).toBe(6000);
  });
});
