import type { RunContext } from '@on.auto/definitions';
import { noCalledDefinitions, onTheStandingClock, recordingJournal } from '@on.auto/definitions/testing';
import { allPermissions } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { listInteractions } from '../requests/list-interactions.ts';
import { approvalDocument, interactionHarness, notificationDocument } from '../testing/index.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const otherRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const anyText: unknown = expect.any(String);

function containing(text: string): unknown {
  return expect.stringContaining(text);
}

const aRun: RunContext = {
  id: runId,
  org: 'acme',
  playbook: 'alpha',
  caller: { id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' },
  definition: { name: 'approve-brief', version: 1 },
  journal: recordingJournal(),
  lineage: { startId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: runId },
  depth: 0,
  callDepth: 0,
  ...noCalledDefinitions,
};

function openDocument(to: string, message: string): string {
  return ['---', `to: '${to}'`, 'expires: P1D', 'output:', '  schema: { type: object }', '---', message].join('\n');
}

async function askedWith(source: string, input: unknown) {
  const playbook = interactionHarness();
  await playbook.define('ask', source);
  return playbook.ask('ask', input, runId);
}

describe('a notification to the inbox', () => {
  it('succeeds at once with an empty output, keeping what it said, and waits for nothing', async () => {
    const playbook = interactionHarness();
    await playbook.define('tell', notificationDocument());

    expect(await playbook.ask('tell', { campaign: 'Spring', owner: 'ada' }, runId)).toMatchObject({
      status: 'succeeded',
      output: { status: 'succeeded', output: {} },
    });
    expect(await playbook.runOf(runId)).toMatchObject({
      output: { record: { to: 'ada', message: 'The brief for Spring is out.', requested_at: anyText } },
    });
    expect(await playbook.call(listInteractions, {})).toMatchObject({ output: { interactions: [] } });
  });
});

describe('a run that cannot ask now', () => {
  it('is unavailable when the playbook holds all the requests it may', async () => {
    const playbook = interactionHarness({ mostOpenRequests: 1 });
    await playbook.define('approve', approvalDocument());
    await playbook.ask('approve', { campaign: 'Spring', owner: 'ada' }, runId);

    expect(await playbook.ask('approve', { campaign: 'Autumn', owner: 'ada' }, otherRunId)).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'requests_full',
    });
  });
});

describe('a party the request cannot go to', () => {
  it.each([
    [
      'not text',
      { owner: { name: 'ada' } },
      'The party the request goes to renders a value that is not text on line 2',
    ],
    ['nothing', { owner: '  ' }, 'The party the request goes to renders to nothing'],
    ['a control character', { owner: 'ada\u0007' }, 'The party the request goes to holds a control character'],
    [
      'longer than 256 bytes',
      { owner: 'a'.repeat(257) },
      'The party the request goes to renders to more than the 256 bytes',
    ],
  ] as const)('ends the run as unworkable when it renders %s, at /to', async (_case, input, detail) => {
    expect(await askedWith(openDocument('{{ input.owner }}', 'Approve?'), input)).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'unworkable',
      detail: containing(detail),
    });
  });
});

describe('a message the request cannot carry', () => {
  it('ends the run as unworkable past 8 KiB, and rejects an input it cannot be rendered from', async () => {
    expect([
      await askedWith(openDocument('ada', '{{ input.text }}'), { text: 'x'.repeat(8193) }),
      await askedWith(openDocument('ada', 'For {{ input.campaign }}'), {}),
      await askedWith(openDocument('ada', '{% for row in input.rows %}{{ row.name }}{% endfor %}'), { rows: [{}] }),
      await askedWith(openDocument('ada', '{% for i in (1..100000000) %}{% endfor %}'), {}),
    ]).toMatchObject([
      {
        reason: 'conflict',
        kind: 'unworkable',
        detail: 'The message renders to more than the 8192 bytes a request may hold',
      },
      { reason: 'invalid_input', issues: [{ pointer: '/input/campaign' }] },
      { reason: 'invalid_input', issues: [{ pointer: '/input' }] },
      { reason: 'invalid_input', detail: 'The message cannot be rendered with this input' },
    ]);
  });

  it('rejects an input the input schema refuses, or nested deeper than a run takes', async () => {
    const deep = Array.from({ length: 600 }).reduce<Schema.Json>((inner) => [inner], 'x');
    const playbook = interactionHarness();
    const prepared = Effect.runSync(onTheStandingClock(playbook.capability.prepare(approvalDocument())));

    expect([
      await askedWith(approvalDocument(), { campaign: 'Spring' }),
      await Effect.runPromise(onTheStandingClock(Effect.flip(prepared.run({ campaign: deep, owner: 'ada' }, aRun)))),
    ]).toMatchObject([
      { reason: 'invalid_input', detail: 'The input: expected the field owner.' },
      { detail: 'The input nests more than the 512 levels an interaction function takes' },
    ]);
  });
});
