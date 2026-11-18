import type { RunContext } from '@on.auto/definitions';
import { noCalledDefinitions, onTheStandingClock, recordingJournal } from '@on.auto/definitions/testing';
import { allPermissions } from '@on.auto/operations';
import { heldForATest, keptForATest } from '@on.auto/operations/testing';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { listInteractions } from '../requests/list-interactions.ts';
import { approvalDocument, askedRunId, fakeTools, interactionHarness, notificationDocument } from '../testing/index.ts';

const anyWords: unknown = expect.any(String);

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const otherRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const anyText: unknown = anyWords;

function containing(text: string): unknown {
  return expect.stringContaining(text);
}

const aRun: RunContext = {
  id: runId,
  org: 'acme',
  playbook: 'alpha',
  caller: { id: 'acme-admin', name: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' },
  definition: { id: '0199a3c4-7d2e-7c1a-9b3f-0000000000d1', name: 'approve-brief', version: 1 },
  journal: recordingJournal(),
  lineage: { startId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: runId },
  depth: 0,
  callDepth: 0,
  ...noCalledDefinitions,
};

function openDocument(to: string, message: string): string {
  return [
    '---',
    `to: '${to}'`,
    'expires: P1D',
    'deliver: agent',
    'output:',
    '  schema: { type: object }',
    '---',
    message,
  ].join('\n');
}

async function askedWith(source: string, input: unknown) {
  const playbook = interactionHarness();
  await playbook.define('ask', source);
  return playbook.ask('ask', input, runId);
}

describe('a notification an earlier release saved without a way to its party', () => {
  it('is held for an agent and succeeds at once with an empty output, keeping what it said, and waits for nothing', async () => {
    const playbook = interactionHarness();
    await playbook.defineAsAnEarlierRelease('tell', notificationDocument([]));

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

describe('a request recorded before its way had to be said', () => {
  it('runs as one held for an agent, deferring with no delivery in its record', async () => {
    const { capability } = interactionHarness();
    const recorded = Effect.runSync(onTheStandingClock(capability.prepare(approvalDocument([]))));

    const asked = await Effect.runPromise(onTheStandingClock(recorded.run({ campaign: 'Spring', owner: 'ada' }, aRun)));

    expect(asked).toMatchObject({ finishesLater: true, record: { to: 'ada' } });
    expect(asked.record).not.toHaveProperty('deliver');
  });
});

describe('a message that formats its input', () => {
  it('writes an amount as money, clips a text and counts its words, as every template may', async () => {
    const playbook = interactionHarness();
    await playbook.define(
      'tell',
      openDocument(
        'ada',
        '{{ input.amount | money }} for {{ input.note | clip: 5 }}, in {{ input.note | words }} words',
      ),
    );
    await playbook.ask('tell', { amount: 1234.5, note: 'Hello, world' }, runId);

    expect(await playbook.runOf(runId)).toMatchObject({
      output: { record: { message: '$1,234.50 for Hello…, in 2 words' } },
    });
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
        detail: anyWords,
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
      { detail: anyWords },
    ]);
  });
});

const page = keptForATest('019a5b12-0000-7000-8000-000000000031', 'text/markdown', 'The offer is on page one.');
const photo = keptForATest('019a5b12-0000-7000-8000-000000000032', 'image/png', new Uint8Array([137, 80, 78, 71]));
const full = keptForATest('019a5b12-0000-7000-8000-000000000033', 'text/plain', 'x'.repeat(8192));
const long = keptForATest('019a5b12-0000-7000-8000-000000000034', 'text/plain', 'x'.repeat(8193));

const rejectionIn = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Struct({ rejection: Schema.Json }) }));

async function keptAsked(message: string, input: Readonly<Record<string, unknown>>) {
  const holding = heldForATest([page, photo, full, long]);
  const playbook = interactionHarness({ tools: { ...fakeTools(), assets: holding } });
  await playbook.define('review-page', openDocument('{{ input.owner }}', message));
  await playbook.ask('review-page', { owner: 'ada', ...input }, askedRunId);
  return { run: await playbook.runOf(askedRunId), opened: holding.opened() };
}

describe('a kept text an interaction request’s message reads', () => {
  it('is written into the message as its text', async () => {
    const { run } = await keptAsked('Please review:\n\n{{ input.page }}', { page: page.reference });

    expect(run).toMatchObject({
      status: 'succeeded',
      output: { record: { to: 'ada', message: 'Please review:\n\nThe offer is on page one.' } },
    });
  });

  it('is read up to the bytes a request may hold, and refused past them before it is opened', async () => {
    const fitting = await keptAsked('{{ input.page }}', { page: full.reference });
    const tooLong = await keptAsked('{{ input.page }}', { page: long.reference });

    expect([fitting, tooLong]).toMatchObject([
      { run: { status: 'succeeded', output: { record: { message: 'x'.repeat(8192) } } }, opened: 1 },
      { run: { output: { status: 'rejected', rejection: { reason: 'conflict', kind: 'unworkable' } } }, opened: 0 },
    ]);
  });

  it('refuses a kept file as it refuses any value that is not text, without opening it', async () => {
    const file = await keptAsked('See {{ input.photo }}', { photo: photo.reference });
    const object = await keptAsked('See {{ input.photo }}', { photo: { a: 1 } });

    expect(file.run).toMatchObject({ output: { status: 'rejected', rejection: { reason: 'conflict' } } });
    expect(rejectionIn(file.run)).toEqual(rejectionIn(object.run));
    expect(file.opened).toBe(0);
  });
});
