import type { Lineage } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { idAt, linksIn } from '../journal-testing/run-links.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { toolUser } from '../testing/capabilities/tool-user.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { relayedId, withHandOn } from '../testing/relaying.ts';
import { testRunId as runId } from '../testing/run-facts.ts';

const toAlpha = toPlaybook('acme', 'alpha');

async function aToolUser() {
  const user = toolUser();
  const operations = definitionOperationsFor([user.capability]);
  const definitions = harness();
  await definitions.call(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'tool-user', name: 'caller', source: 'x' }),
  );
  const running = (input: object, lineage?: Lineage) =>
    definitions.call(operations.runDefinition, {
      ...toAlpha(acmeAdmin, { type: 'tool-user', name: 'caller', input, run_id: runId }),
      ...(lineage === undefined ? {} : { lineage }),
    });
  return { ...definitions, running };
}

describe('the lineage of a run that calls tools', () => {
  it('starts with no cause, links each call to the answer before it and each answer to its call, and the finish to the last answer', async () => {
    const definitions = await aToolUser();
    await definitions.running({ calls: 2 });

    expect(await linksIn(definitions)).toEqual([
      { type: 'run_started', id: idAt(1), causationId: null, correlationId: runId },
      { type: 'tool_call_started', id: idAt(2), causationId: idAt(1), correlationId: runId },
      { type: 'tool_call_started', id: idAt(3), causationId: idAt(1), correlationId: runId },
      { type: 'tool_call_answered', id: idAt(4), causationId: idAt(2), correlationId: runId },
      { type: 'tool_call_answered', id: idAt(5), causationId: idAt(3), correlationId: runId },
      { type: 'run_succeeded', id: idAt(6), causationId: idAt(5), correlationId: runId },
    ]);
  });

  it('finishes caused by its start when it called no tool, and a failure too', async () => {
    const definitions = await aToolUser();
    await definitions.running({ calls: 0, ending: 'unavailable' });

    expect((await linksIn(definitions)).map(({ type, causationId }) => [type, causationId])).toEqual([
      ['run_started', null],
      ['run_rejected', idAt(1)],
    ]);
  });

  it('started by another run, is caused by what it was given and belongs to the run it was given', async () => {
    const definitions = await aToolUser();
    const lineage = { causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: 'root' };
    await definitions.running({ calls: 0 }, lineage);

    expect((await linksIn(definitions)).map(({ causationId, correlationId }) => [causationId, correlationId])).toEqual([
      [lineage.causationId, 'root'],
      [idAt(1), 'root'],
    ]);
  });

  it('is never taken from the input of run_definition, which refuses a field it does not know', async () => {
    const definitions = await aToolUser();
    const lineage = { causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: 'root' };

    expect(await definitions.running({ calls: 0, lineage })).toMatchObject({ status: 'succeeded' });
    expect(
      await definitions.call(
        definitionOperationsFor([toolUser().capability]).runDefinition,
        toAlpha(acmeAdmin, { type: 'tool-user', name: 'caller', input: { calls: 0 }, lineage }),
      ),
    ).toMatchObject({ status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/lineage' }] });
  });
});

describe('the lineage of a run that finishes later', () => {
  it('defers caused by its start, and settles caused by what settled it', async () => {
    const definitions = await withHandOn();
    await definitions.running();
    const settledBy = { causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: relayedId };
    await definitions.settling({ status: 'succeeded', output: 'done', record: {} }, undefined, settledBy);

    expect((await linksIn(definitions)).map(({ type, causationId }) => [type, causationId])).toEqual([
      ['run_started', null],
      ['run_deferred', idAt(1)],
      ['run_succeeded', settledBy.causationId],
    ]);
  });

  it('started again after it was rejected, is caused by its latest start from then on', async () => {
    const definitions = await aToolUser();
    await definitions.running({ calls: 0, ending: 'unavailable' });
    await definitions.running({ calls: 0, ending: 'unavailable' });

    expect((await linksIn(definitions)).map(({ type, causationId }) => [type, causationId])).toEqual([
      ['run_started', null],
      ['run_rejected', idAt(1)],
      ['run_started', null],
      ['run_rejected', idAt(3)],
    ]);
  });
});
