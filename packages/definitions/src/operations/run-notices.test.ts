import { beforeGoingOnOf, type Notice } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability } from '../capability/capability.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const checkIt: Notice = { kind: 'checked', detail: 'Its run read only; check it.', at: '/tools', certainty: 'likely' };

function recordingCapability() {
  return defineCapability({
    type: 'recorded',
    title: 'Recorded',
    guide: { name: 'recorded' },
    noun: { one: 'recorded function', other: 'recorded functions' },
    describeOutput: () => 'It answered its document.',
    mediaType: 'text/plain',
    parse: (source: string) => Effect.succeed({ text: source }),
    summarize: ({ text }) => ({ description: text }),
    run: ({ text }) =>
      Effect.succeed({
        output: text,
        record: text === 'noticed' ? { notices: [checkIt, checkIt, checkIt, checkIt] } : {},
      }),
  });
}

async function ranAs(source: string) {
  const operations = definitionOperationsFor([recordingCapability()]);
  const { call } = harness();
  await call(operations.createDefinition, toAlpha(acmeAdmin, { type: 'recorded', name: 'judge', source }));
  const ran = await call(operations.runDefinition, toAlpha(acmeAdmin, { type: 'recorded', name: 'judge' }));
  return { ran, call, operations };
}

describe('the answer of a run the agent asked for', () => {
  it('carries the notices its record holds, at most three, and what to do with them', async () => {
    const { ran } = await ranAs('noticed');

    expect(ran).toMatchObject({
      status: 'succeeded',
      output: { output: 'noticed', record: { notices: [checkIt, checkIt, checkIt, checkIt] } },
    });
    expect(ran).toMatchObject({
      output: { notices: [checkIt, checkIt, checkIt], before_going_on: beforeGoingOnOf(3) },
    });
  });

  it('carries none when its record holds none', async () => {
    const { ran } = await ranAs('plain');

    expect(ran).toMatchObject({ status: 'succeeded', output: { output: 'plain' } });
    expect(JSON.stringify(ran)).not.toContain('notices');
  });
});
