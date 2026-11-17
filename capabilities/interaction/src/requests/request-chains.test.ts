import type { Capability } from '@on.auto/definitions';
import { echo } from '@on.auto/definitions/testing';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { alpha, approvalDocument, interactionHarness, type RunLink } from '../testing/index.ts';
import { listInteractions, listInteractionsAbout, type RequestThings } from './list-interactions.ts';
import { mostCauses } from './request-causes.ts';

const echoingWorkflow: Capability = { ...echo, type: 'workflow' };

const prepareRevision = '0199a3c4-7d2e-7c1a-9b3f-000000000001';
const approveAndSend = '0199a3c4-7d2e-7c1a-9b3f-000000000002';
const askTheProducer = '0199a3c4-7d2e-7c1a-9b3f-000000000003';

const ListedSchema = Schema.Struct({
  output: Schema.Struct({ interactions: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) }),
});

const decodeListed = Schema.decodeUnknownSync(ListedSchema);

async function playbookWithTwoWorkflows() {
  const playbook = interactionHarness({ others: [echoingWorkflow] });
  await playbook.define('ask-the-producer', approvalDocument());
  await playbook.defineAs('workflow', 'prepare-revision', JSON.stringify({ greeting: 'prepare' }));
  await playbook.defineAs('workflow', 'approve-and-send', JSON.stringify({ greeting: 'approve' }));
  await playbook.defineAs('workflow', 'find-requests', JSON.stringify({ greeting: 'find' }));
  return playbook;
}

type Playbook = Awaited<ReturnType<typeof playbookWithTwoWorkflows>>;

async function firstFactIdOf(playbook: Playbook, run: string): Promise<string> {
  const { records } = await Effect.runPromise(
    playbook.ledger.service.readRecorded(alpha, { kind: 'run', run }, { order: 'asc', limit: 1 }),
  );
  return String(records[0]?.id);
}

async function startedByAnEventOf(playbook: Playbook, run: string): Promise<RunLink> {
  return {
    lineage: { causationId: await firstFactIdOf(playbook, run), correlationId: null },
    trigger: { kind: 'event', reference: 'change-request.found' },
  };
}

function calledFrom(run: string, reference = '/do/1/ask-the-producer'): RunLink {
  return { calledBy: { run_id: run, reference, run: 1 } };
}

function ranAs(playbook: Playbook, name: string, run: string, link: RunLink = {}) {
  return playbook.runLinked({ type: 'workflow', name, input: {}, run_id: run }, link);
}

function askedFrom(playbook: Playbook, run: string, link: RunLink, campaign = 'Spring') {
  return playbook.runLinked(
    { type: 'interaction', name: 'ask-the-producer', input: { campaign, owner: 'ada' }, run_id: run },
    link,
  );
}

async function listedOf(playbook: Playbook) {
  return decodeListed(await playbook.call(listInteractions, {})).output.interactions;
}

describe('a question a workflow step asked', () => {
  it('names the workflow run and step that asked, and the runs that led to it, newest first', async () => {
    const playbook = await playbookWithTwoWorkflows();
    await ranAs(playbook, 'prepare-revision', prepareRevision);
    await ranAs(playbook, 'approve-and-send', approveAndSend, await startedByAnEventOf(playbook, prepareRevision));
    await askedFrom(playbook, askTheProducer, calledFrom(approveAndSend));

    expect(await listedOf(playbook)).toEqual([
      expect.objectContaining({
        run_id: askTheProducer,
        within: { run_id: approveAndSend, workflow: 'approve-and-send', step: 'do/1/ask-the-producer' },
        causes: [approveAndSend, prepareRevision],
      }),
    ]);
  });

  it('follows a workflow another workflow called, and stops where a run was started by hand', async () => {
    const playbook = await playbookWithTwoWorkflows();
    await ranAs(playbook, 'prepare-revision', prepareRevision);
    await ranAs(playbook, 'approve-and-send', approveAndSend, calledFrom(prepareRevision, '/do/0/approve'));
    await askedFrom(playbook, askTheProducer, calledFrom(approveAndSend));

    expect(await listedOf(playbook)).toEqual([expect.objectContaining({ causes: [approveAndSend, prepareRevision] })]);
  });
});

describe('a question whose chain ends', () => {
  it('stops at the run whose event it cannot find, or whose event names no cause', async () => {
    const playbook = await playbookWithTwoWorkflows();
    await ranAs(playbook, 'prepare-revision', prepareRevision, {
      lineage: { causationId: '0199a3c4-7d2e-7c1a-9b3f-0000000000ff', correlationId: null },
      trigger: { kind: 'event', reference: 'change-request.found' },
    });
    await ranAs(playbook, 'approve-and-send', approveAndSend, {
      trigger: { kind: 'event', reference: 'change-request.found' },
    });
    await askedFrom(playbook, askTheProducer, calledFrom(prepareRevision));
    await askedFrom(playbook, `${askTheProducer.slice(0, -1)}4`, calledFrom(approveAndSend), 'Summer');

    expect((await listedOf(playbook)).map(({ causes }) => causes)).toEqual([[approveAndSend], [prepareRevision]]);
  });

  it(`lists at most ${mostCauses} runs before it`, async () => {
    const playbook = await playbookWithTwoWorkflows();
    const runs = Array.from(
      { length: mostCauses + 2 },
      (_, index) => `0199a3c4-7d2e-7c1a-9b3f-1000000000${String(index).padStart(2, '0')}`,
    );
    await runs
      .slice(1)
      .reduce(
        (before: Promise<unknown>, run, index) =>
          before.then(() => ranAs(playbook, 'find-requests', run, calledFrom(String(runs[index]), '/do/0/again'))),
        ranAs(playbook, 'find-requests', String(runs[0])),
      );
    const last = String(runs.at(-1));
    await askedFrom(playbook, askTheProducer, calledFrom(last));

    expect(await listedOf(playbook)).toEqual([
      expect.objectContaining({ causes: runs.toReversed().slice(0, mostCauses) }),
    ]);
  });
});

describe('a question no workflow step asked', () => {
  it('names no workflow run and no runs before it', async () => {
    const playbook = await playbookWithTwoWorkflows();
    await playbook.ask('ask-the-producer', { campaign: 'Spring', owner: 'ada' }, askTheProducer);

    const [listed] = await listedOf(playbook);

    expect(listed).not.toHaveProperty('within');
    expect(listed).not.toHaveProperty('causes');
  });

  it('names neither when the run it names as its caller is not in the playbook', async () => {
    const playbook = await playbookWithTwoWorkflows();
    await askedFrom(playbook, askTheProducer, calledFrom(approveAndSend));

    const [listed] = await listedOf(playbook);

    expect(listed).not.toHaveProperty('within');
    expect(listed).not.toHaveProperty('causes');
  });
});

describe('the things a question is about', () => {
  it('are asked for once a page, with the causes of each question, none for one no step asked, and given back to each in turn', async () => {
    const playbook = await playbookWithTwoWorkflows();
    await ranAs(playbook, 'prepare-revision', prepareRevision);
    await ranAs(playbook, 'approve-and-send', approveAndSend);
    await askedFrom(playbook, askTheProducer, calledFrom(prepareRevision));
    await askedFrom(playbook, `${askTheProducer.slice(0, -1)}4`, calledFrom(approveAndSend), 'Summer');
    await playbook.ask('ask-the-producer', { campaign: 'Autumn', owner: 'ada' }, `${askTheProducer.slice(0, -1)}5`);
    const asked: (readonly (readonly string[])[])[] = [];
    const things: RequestThings = (chains) => {
      asked.push(chains);
      return Effect.succeed([[], [{ goal: 'revisions', id: 'a1', per: 'letterhead' }], []]);
    };

    const listed = decodeListed(await playbook.call(listInteractionsAbout(things), {})).output.interactions;

    expect(asked).toEqual([[[], [approveAndSend], [prepareRevision]]]);
    expect(listed.map(({ about }) => about)).toEqual([
      undefined,
      [{ goal: 'revisions', id: 'a1', per: 'letterhead' }],
      [],
    ]);
  });

  it('are left out of a question no step asked, whatever the things answer for it', async () => {
    const playbook = await playbookWithTwoWorkflows();
    await playbook.ask('ask-the-producer', { campaign: 'Spring', owner: 'ada' }, askTheProducer);
    const asked: (readonly (readonly string[])[])[] = [];
    const things: RequestThings = (chains) => {
      asked.push(chains);
      return Effect.succeed([[{ goal: 'revisions', id: 'a1' }]]);
    };

    const [listed] = decodeListed(await playbook.call(listInteractionsAbout(things), {})).output.interactions;

    expect(asked).toEqual([[[]]]);
    expect(listed).not.toHaveProperty('about');
  });
});
