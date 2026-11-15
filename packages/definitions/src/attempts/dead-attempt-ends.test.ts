import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { deadAttemptEnder, defineCapability, type Capability } from '../index.ts';
import { runWordsFor } from '../plain-language/run-words.ts';
import type { RunCommand } from '../runs/run-commands.ts';
import { RunDetailSchema } from '../runs/run.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook } from '../testing/harness.ts';
import { heldFromItsStart } from '../testing/run-facts.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const runId = '0199a3c4-7d2e-7c1a-9b3f-0000000000f1';

const alpha = { org: 'acme', playbook: 'alpha' };

const stream = `playbook/acme/alpha/runs/${runId}`;

const longestCallMs = 70_000;

const acted = { runId, by: 'acme-admin', at: firstMoment };

const sent = { server: 'slack', tool: 'post_message', arguments_bytes: 2 };

const decodeRun = Schema.decodeUnknownSync(RunDetailSchema);

const startOfTheRun: RunCommand = {
  type: 'start',
  definition_type: 'system-call',
  name: 'post',
  input: {},
  started_by: { id: acmeAdmin.id, name: acmeAdmin.name },
  definition_version: 1,
  calls_tools: true,
  ...acted,
};

function callStarted(number: number, readOnly = false): RunCommand {
  const call = { call_id: `toolu_${number}`, ...sent };
  return {
    type: 'call',
    fact: { type: 'tool_call_started', data: readOnly ? { ...call, read_only: true } : call },
    ...acted,
  };
}

function callAnswered(number: number): RunCommand {
  const data = { number, is_error: false, result_bytes: 2, duration_ms: 5, jsonrpc_id: 1 };
  return { type: 'call', fact: { type: 'tool_call_answered', data }, ...acted };
}

const systemCall: Capability = defineCapability({
  type: 'system-call',
  title: 'System call',
  guide: { name: 'system-call' },
  noun: { one: 'system call', other: 'system calls' },
  describeOutput: () => 'It called a system.',
  mediaType: 'text/plain',
  parse: (source: string) => Effect.succeed(source),
  summarize: () => ({}),
  run: () => Effect.never,
  reachesOutside: true,
  mayChangeOutside: true,
  callsTools: () => true,
  longestRunOf: () => longestCallMs,
});

function momentAfter(ms: number): string {
  return new Date(Date.parse(firstMoment) + ms).toISOString();
}

async function leftByItsAttempt(facts: readonly RunCommand[], start: RunCommand = startOfTheRun) {
  const operations = definitionOperationsFor([systemCall]);
  const definitions = harness();
  const { service } = definitions.ledger;
  await definitions.call(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'system-call', name: 'post', source: 'post' }),
  );
  const heldWith = await definitions.run(heldFromItsStart(service, stream, start, facts));
  const reading = () => definitions.call(operations.getRun, toAlpha(acmeAdmin, { run_id: runId }));
  const lineage = { causationId: null, correlationId: runId };
  return {
    service,
    heldWith,
    reading,
    ending: (fencingToken = heldWith, afterMs = 0, ledger: typeof service = service) =>
      definitions.run(
        deadAttemptEnder(ledger)({ run: { ...alpha, id: runId }, lineage, fencingToken }),
        momentAfter(afterMs),
      ),
    wordsOfTheRun: async () => {
      const read = await reading();
      return read.status === 'succeeded' ? runWordsFor([systemCall])(decodeRun(read.output), 'looked up') : undefined;
    },
    recorded: async () => {
      const read = service.readRecorded(alpha, { kind: 'run', run: runId }, { order: 'asc', limit: 20 });
      const { records } = await definitions.run(Effect.orDie(read));
      return records.map(({ type, data }) => ({ type, data }));
    },
  };
}

const interruptedCall = (number: number) => ({
  type: 'tool_call_failed',
  data: { number, because: 'interrupted', duration_ms: 0, jsonrpc_id: null },
});

describe('a run within its call whose attempt a shell knows died, with a call that may change something open', () => {
  it('ends that call as interrupted and the run as not known to have acted or not, in the words the core has for it', async () => {
    const { ending, recorded, wordsOfTheRun } = await leftByItsAttempt([callStarted(1)]);

    expect(await ending()).toBe('ended');
    expect((await recorded()).slice(2)).toEqual([
      interruptedCall(1),
      {
        type: 'run_rejected',
        data: {
          rejection: {
            reason: 'conflict',
            kind: 'effect_unknown',
            because: 'call_outcome_unknown',
            detail:
              'Its attempt ended while it called a tool that may change something, so whether that call did is not known',
          },
        },
      },
    ]);
    expect(await wordsOfTheRun()).toBe(
      'The run of the system call “post” did not go through: it could not finish after calling a tool that may change something, so whether that happened is not known, because the server restarted while it called a tool that may change something, so whether that call did is not known. It is not run again by itself: a person decides, or a workflow rule that names this kind; its history shows the call.',
    );
  });
});

describe('a run within its call whose attempt a shell knows died, every tool it called only reading', () => {
  it('ends as not finished, running it again being safe, its call open or answered', async () => {
    const open = await leftByItsAttempt([callStarted(1, true)]);
    const answeredFirst = await leftByItsAttempt([callStarted(1, true), callAnswered(1)]);
    const notFinished = {
      reason: 'unavailable',
      kind: 'tools_unfinished',
      detail: "Every tool it called only reads, by its server's own account, so nothing was changed",
    };

    await open.ending();
    await answeredFirst.ending();

    expect((await open.recorded()).slice(2)).toEqual([
      interruptedCall(1),
      { type: 'run_rejected', data: { rejection: notFinished } },
    ]);
    expect((await answeredFirst.recorded()).slice(3)).toEqual([
      { type: 'run_rejected', data: { rejection: notFinished } },
    ]);
    expect(await open.wordsOfTheRun()).toBe(
      "The run of the system call “post” did not go through: it called tools but could not finish. Every tool it called is marked reads, so running it again is safe: a new run, or a workflow's retry, may make it; its history shows what it called.",
    );
  });
});

describe('a run within its call whose attempt a shell knows died, having called no tool', () => {
  it('breaks down, as a run cut by its server stopping does', async () => {
    const { ending, recorded, wordsOfTheRun } = await leftByItsAttempt([]);

    await ending();

    expect((await recorded()).slice(1)).toEqual([{ type: 'run_failed', data: {} }]);
    expect(await wordsOfTheRun()).toBe(
      'The run of the system call “post” broke down because of a problem inside the server; it was not caused by anything you did.',
    );
  });
});

describe('a run within its call whose attempt a shell knows died after a call that may change something answered', () => {
  it('ends as not known to have acted or not, as the core ends any run that called such a tool and could not finish', async () => {
    const { ending, recorded } = await leftByItsAttempt([callStarted(1), callAnswered(1), callStarted(2, true)]);

    await ending();

    expect((await recorded()).slice(4)).toEqual([
      interruptedCall(2),
      {
        type: 'run_rejected',
        data: {
          rejection: {
            reason: 'conflict',
            kind: 'effect_unknown',
            because: 'call_outcome_unknown',
            detail:
              'Its attempt ended while it called a tool that may change something, so whether that call did is not known',
          },
        },
      },
    ]);
  });
});

describe('a run within its call whose caller asked to cancel it, whose attempt a shell then knows died', () => {
  it('ends cancelled as its caller asked, with its open call interrupted, and is never run again under its id', async () => {
    const deadline: RunCommand = {
      type: 'cancel',
      kind: 'deadline',
      reason: 'The step that called it ran out of time',
      byItsCaller: true,
      ...acted,
    };
    const calledNothing = await leftByItsAttempt([deadline], { ...startOfTheRun, calls_tools: false });
    const callOpen = await leftByItsAttempt([callStarted(1), deadline]);

    expect([await calledNothing.ending(), await callOpen.ending()]).toEqual(['ended', 'ended']);
    expect((await calledNothing.recorded()).slice(2)).toEqual([
      {
        type: 'run_rejected',
        data: {
          rejection: { reason: 'cancelled', kind: 'deadline', detail: 'The step that called it ran out of time' },
        },
      },
    ]);
    expect((await callOpen.recorded()).slice(3)).toEqual([
      interruptedCall(1),
      {
        type: 'run_rejected',
        data: {
          rejection: {
            reason: 'cancelled',
            kind: 'deadline',
            detail:
              'The step that called it ran out of time; its attempt ended while it called a tool that may change something, so whether that call did is not known',
          },
        },
      },
    ]);
    expect(await calledNothing.reading()).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'cancelled', kind: 'deadline' } },
    });
  });
});

describe('a run within its call that takes longer than it states, whose holder is alive', () => {
  it('is ended only for the attempt a shell names as gone, never for how long it has been quiet', async () => {
    const { service, ending, reading, heldWith } = await leftByItsAttempt([], { ...startOfTheRun, calls_tools: false });
    const quietNeverRead = { ...service, ageOfLastAppend: () => Effect.die('The ending read how quiet the run is') };

    const forAnotherAttempt = await ending(heldWith + 1, 10 * longestCallMs, quietNeverRead);
    const stillGoing = await reading();
    const forItsHolder = await ending(heldWith, 10 * longestCallMs, quietNeverRead);

    expect([forAnotherAttempt, forItsHolder]).toEqual(['not_running', 'ended']);
    expect(stillGoing).toMatchObject({ output: { status: 'started' } });
  });
});

describe('a run the ending of a dead attempt does not end', () => {
  it('is not running once it has ended, or where it never started', async () => {
    const finish: RunCommand = {
      type: 'finish',
      result: { type: 'run_succeeded', data: { output: 'posted', record: {} } },
      ...acted,
    };
    const cancelFirst: RunCommand = {
      type: 'cancel',
      kind: 'requested',
      reason: 'Not needed',
      byItsCaller: true,
      ...acted,
    };
    const ended = await leftByItsAttempt([finish]);
    const neverStarted = await leftByItsAttempt([], cancelFirst);

    expect([await ended.ending(), await neverStarted.ending()]).toEqual(['not_running', 'not_running']);
  });

  it('outlives its call where it resumes or finishes later, which its shell resumes or settles', async () => {
    const resumes = await leftByItsAttempt([], { ...startOfTheRun, resumes: true });
    const finishesLater = await leftByItsAttempt([], { ...startOfTheRun, finishes_later: true });

    expect([await resumes.ending(), await finishesLater.ending()]).toEqual(['outlives_its_call', 'outlives_its_call']);
  });
});
