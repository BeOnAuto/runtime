import { Conflict, messageIdOf, type StreamReader, type StreamWriter } from '@on.auto/operations';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { runEnded, runSettler, workRecorder } from '../index.ts';
import { runDecider, runDeciderAsRead } from '../runs/run-decider.ts';
import {
  asked,
  askedLineage as lineage,
  askedRun as run,
  askedStream as stream,
  askingFacts,
  attempted,
  nudge,
  question,
} from '../testing/asked-runs.ts';
import { askedRequest } from '../testing/asking.ts';
import { recordedAdmin } from '../testing/callers.ts';

describe('a run of a capability that answers by its input', () => {
  it('records that it finishes later from the input it is given, and finishes in its call for another', async () => {
    const now = await asked({ now: true });
    const later = await asked();

    expect([now.started, later.started]).toMatchObject([
      { status: 'succeeded', output: { status: 'succeeded', output: { answered: question } } },
      { status: 'succeeded', output: { status: 'started' } },
    ]);
    expect([(await now.recorded())[0]?.data, (await later.recorded()).map(({ type, data }) => [type, data])]).toEqual([
      { input: { now: true }, started_by: recordedAdmin },
      [
        ['run_started', { input: { campaign: 'Spring' }, started_by: recordedAdmin, finishes_later: true }],
        ['run_deferred', { record: { ...askedRequest, message: question } }],
      ],
    ]);
  });
});

describe('the work a capability records on a run that finishes later', () => {
  it('is recorded under the name its capability declares, as the playbook itself, with the lineage it is given', async () => {
    const { record, recorded, state } = await asked();

    const first = await Effect.runPromise(record(run, nudge(1), lineage));
    const second = await Effect.runPromise(record(run, nudge(2), { ...lineage, causationId: first.id }));

    expect([first.id, second.id]).toEqual([messageIdOf(stream, 3), messageIdOf(stream, 4)]);
    expect(
      (await recorded()).slice(2).map(({ type, data, causationId, context }) => [type, data, causationId, context.by]),
    ).toEqual([
      ['nudge_sent', { number: 1 }, 'request-1', 'playbook:alpha'],
      ['nudge_sent', { number: 2 }, first.id, 'playbook:alpha'],
    ]);
    const onTheRun = {
      by: 'playbook:alpha',
      runId: run.id,
      definitionType: 'asking',
      definitionName: 'approve',
      definitionVersion: 1,
    };
    expect((await state())?.work).toEqual([
      { type: 'nudge_sent', data: { number: 1 }, context: { ...onTheRun, at: first.at } },
      { type: 'nudge_sent', data: { number: 2 }, context: { ...onTheRun, at: second.at } },
    ]);
  });

  it('is refused when no capability of the playbook declares it, when its capability’s own rule refuses it, and for a run the playbook cannot hold', async () => {
    const { record } = await asked();
    const enough = new Conflict({ detail: 'The run has been nudged enough' });

    expect([
      await attempted(record(run, { type: 'work', fact: { type: 'delivery_started', data: { number: 1 } } }, lineage)),
      await attempted(record(run, nudge(1), lineage, () => enough)),
      await attempted(record({ ...run, id: 'not-a-run' }, nudge(1), lineage)),
    ]).toEqual([
      Result.fail(
        new Conflict({
          detail: 'No capability of this playbook declares the fact delivery_started, so the run does not record it',
        }),
      ),
      Result.fail(enough),
      Result.fail(new Conflict({ detail: 'There is no such run in this playbook, so it records no work' })),
    ]);
  });
});

describe('the work a capability records on a run that has ended', () => {
  it('is refused once the run has ended, and on a run that ended within its call', async () => {
    const later = await asked();
    const now = await asked({ now: true });
    await Effect.runPromise(
      runSettler(later.ledger.service)(run, { status: 'succeeded', output: { choice: 'approve' } }),
    );

    expect([
      await attempted(later.record(run, nudge(1), lineage)),
      await attempted(now.record(run, nudge(1), lineage)),
    ]).toEqual([Result.fail(runEnded), Result.fail(runEnded)]);
  });
});

describe('the work a capability records on a run that changes under it, or on a playbook that knows no capability', () => {
  it('is read again when the run changed between its read and its record, and then recorded', async () => {
    const { ledger, recorded } = await asked();
    const other = workRecorder(ledger.service, askingFacts);
    const turns = { next: (): Effect.Effect<unknown, unknown> => other(run, nudge(1), lineage) };
    const changedOnce: StreamReader & StreamWriter = {
      ...ledger.service,
      execute: (named, decider, command, given) => {
        const turn = Effect.orDie(turns.next());
        turns.next = () => Effect.void;
        return Effect.andThen(turn, ledger.service.execute(named, decider, command, given));
      },
    };

    await Effect.runPromise(workRecorder(changedOnce, askingFacts)(run, nudge(2), lineage));

    expect((await recorded()).slice(2).map(({ data }) => data)).toEqual([{ number: 1 }, { number: 2 }]);
  });

  it('is refused by the run decider every read uses, which knows no capability', async () => {
    const { ledger, recorded } = await asked();
    const record = workRecorder(ledger.service, { decider: runDecider, asRead: runDeciderAsRead });

    expect(await attempted(record(run, nudge(1), lineage))).toEqual(
      Result.fail(
        new Conflict({
          detail: 'No capability of this playbook declares the fact nudge_sent, so the run does not record it',
        }),
      ),
    );
    expect((await recorded()).map(({ type }) => type)).toEqual(['run_started', 'run_deferred']);
  });
});
