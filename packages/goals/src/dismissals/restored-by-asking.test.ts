import { dismissalsName } from '@on.auto/activity';
import type { Context, RecordedEvent } from '@on.auto/operations';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { built, experimentId, results, startedAs } from '../assessor/assessor-fixtures.ts';
import { deliveredAll, finished, monday, sales, salesKey, type Book } from '../assessor/assessor-ledger.ts';
import { assessorOf } from '../assessor/assessor.ts';
import { restoredByAskingOf } from './restored-by-asking.ts';

const minute = 60_000;

const measured = finished({ id: 'measured', data: results(0) });

const thing = experimentId('MAR-41');

const owner = { id: 'person:owner', name: 'Owner' };

const iso = (at: number) => new Date(at).toISOString();

const asked = {
  to: 'owner@example.com',
  message: 'Is this experiment still worth running?',
  answer_schema: { type: 'object' },
  expires_at: iso(monday + 60 * minute),
  requested_at: iso(monday + 5 * minute),
};

interface Deferral {
  readonly at: number;
  readonly by?: string;
  readonly record?: unknown;
  readonly context?: Partial<Context>;
}

function deferred({ at, by = 'run-measured', record = asked, context = {} }: Deferral): RecordedEvent {
  return {
    id: `deferred-${String(at)}`,
    causationId: null,
    correlationId: by,
    stream: 'runs/ask-1',
    version: 2,
    globalPosition: 9,
    type: 'run_deferred',
    data: { record },
    context: {
      at: iso(at),
      by: 'playbook:sales',
      runId: 'ask-1',
      definitionType: 'interaction',
      definitionName: 'ask-owner',
      calledBy: { runId: by, reference: '/do/1', run: 1 },
      ...context,
    },
    recordedAt: iso(at),
    cursor: `deferred-${String(at)}`,
  };
}

async function measuredAndDismissedAt(at: number) {
  const { book, ports } = await built(startedAs(measured), () => monday + 30 * minute);
  await deliveredAll(assessorOf(ports), measured);
  await book.append(
    `assessments/${thing}`,
    'goal_dismissed',
    { goal: 'paying-customers', per: 'MAR-41', at: iso(at), by: owner, requests: [] },
    { at: iso(at) },
  );
  return { book, consumer: restoredByAskingOf(ports) };
}

const askOwnerKey = 'definition/acme/interaction-of-ask-owner/';

function delivered(consumer: ReturnType<typeof restoredByAskingOf>, record: RecordedEvent, after?: string) {
  const read = consumer.read({ playbook: sales, playbookKey: salesKey, filedUnder: askOwnerKey, record });
  return Effect.runPromise(
    Effect.gen(function* () {
      if (read === 'unreadable') {
        return ['unreadable'];
      }
      const { deliveries } = yield* read.batchOf(after, 100);
      const done: string[] = [];
      for (const delivery of deliveries) {
        const result = yield* Effect.result(delivery.deliver);
        done.push(Result.isSuccess(result) ? delivery.key : `failed ${delivery.key}`);
      }
      return done;
    }),
  );
}

const standing = async (book: Book) => (await book.rows(dismissalsName))[thing]?.['dismissed'];

describe('a request asked about a dismissed thing after its dismissal', () => {
  it('restores the thing, recorded by Auto, once however often the request is delivered', async () => {
    const { book, consumer } = await measuredAndDismissedAt(monday + 10 * minute);

    const first = await delivered(consumer, deferred({ at: monday + 20 * minute }));
    const again = await delivered(consumer, deferred({ at: monday + 20 * minute }));
    const resumed = await delivered(consumer, deferred({ at: monday + 20 * minute }), 'asked');

    expect([first, again, resumed]).toEqual([['asked'], ['asked'], []]);
    expect(await book.factsOf(`assessments/${thing}`)).toEqual([
      'goal_assessment_opened',
      'goal_observed',
      'goal_dismissed',
      'goal_restored',
    ]);
    expect((await book.rows(dismissalsName))[thing]).toMatchObject({ dismissed: false, by: 'playbook:sales' });
    expect(consumer).toMatchObject({ name: 'dismissed things asked about again', types: ['run_deferred'] });
  });

  it('is read the same from a request asked by a run of its own, with no workflow named', async () => {
    const { book, consumer } = await measuredAndDismissedAt(monday + 10 * minute);
    const { calledBy: _calledBy, definitionName: _name, ...alone } = deferred({ at: monday + 20 * minute }).context;

    await delivered(consumer, {
      ...deferred({ at: monday + 20 * minute }),
      context: { ...alone, runId: 'run-measured' },
    });

    expect(await standing(book)).toBe(false);
  });
});

describe('a deferral that leaves a dismissed thing dismissed', () => {
  it('is a request asked before the dismissal, or about another thing, or a wait that is no request, or of no run', async () => {
    const { book, consumer } = await measuredAndDismissedAt(monday + 10 * minute);
    const { runId: _run, ...ofNoRun } = deferred({ at: monday + 20 * minute }).context;

    const deliveredEach = await Promise.all([
      delivered(consumer, deferred({ at: monday + 5 * minute })),
      delivered(consumer, deferred({ at: monday + 20 * minute, by: 'run-elsewhere' })),
      delivered(consumer, deferred({ at: monday + 20 * minute, record: { waits_for: 'a generation' } })),
      delivered(consumer, { ...deferred({ at: monday + 20 * minute }), context: ofNoRun }),
    ]);

    expect(deliveredEach).toEqual([['asked'], ['asked'], [], []]);
    expect(await standing(book)).toBe(true);
    expect(await book.factsOf(`assessments/${thing}`)).toEqual([
      'goal_assessment_opened',
      'goal_observed',
      'goal_dismissed',
    ]);
  });
});
