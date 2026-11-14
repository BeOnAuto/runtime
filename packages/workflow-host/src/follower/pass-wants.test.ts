import { Effect, Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { factPayloadsOn } from '../ledger-testing/ledger-connections.ts';
import { deliveringEach, finishedAt, playbookKey } from '../reaction-testing/playbook-passes.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import type { Consumer, FollowedRecord } from './consumers.ts';
import { followedPlaybooksOn } from './followed-playbooks.ts';
import { passOf } from './playbook-pass.ts';
import { stepOf, type StepParts, type Stepping } from './record-steps.ts';

interface Wanting {
  readonly consumer: Consumer;
  readonly delivered: readonly string[];
  readonly asked: readonly string[];
}

function wanting(name: string, wants?: boolean, wantedWith?: string): Wanting {
  const delivered: string[] = [];
  const asked: string[] = [];
  const noting = deliveringEach((id) => {
    delivered.push(`${name} ${id}`);
  });
  return {
    consumer: {
      ...noting,
      name,
      types: ['run_succeeded'],
      ...(wantedWith === undefined ? {} : { wantedWith }),
      ...(wants === undefined
        ? {}
        : {
            wants: (key: string) =>
              Effect.sync(() => {
                asked.push(key);
                return wants;
              }),
          }),
    },
    delivered,
    asked,
  };
}

async function passedOnce(...registered: readonly Consumer[]) {
  const reads: boolean[] = [];
  const database = await openedOn(await onSQLite());
  const playbooks = followedPlaybooksOn(database);
  const pass = passOf({
    database,
    playbooks,
    records: {
      after: (_playbook, _cursor, delivers) =>
        Effect.sync(() => {
          reads.push(delivers.size > 0);
          return { records: [finishedAt(1)], hasMore: false, nextCursor: null, lastExamined: null };
        }),
    },
    consumers: [],
    registered,
    calls: [],
    definitionType: 'workflow',
    applyDefinitionRecord: Function.constant(Effect.succeed('applied')),
    unreadable: Function.constant(Effect.void),
    contentMissing: Function.constant(Effect.void),
    factPayloadsOf: factPayloadsOn(database),
    passedEarly: Function.constant(Effect.void),
    holdsUnreadable: false,
    now: Date.now,
    holdNotes: { tried: () => Effect.void, failed: () => Effect.void, lifted: () => Effect.void },
  });
  await Effect.runPromise(playbooks.follow(playbookKey, null));
  const end = await Effect.runPromise(pass(playbookKey, 'signal'));
  return { end, reads };
}

describe('a consumer that says whether it wants the records of a playbook', () => {
  it('is asked once a pass, though the pass works out the types it wants as it begins and again at a record whose type was not named, and when it does not want them, is handed nothing and costs the pass no read of their data', async () => {
    const unwanted = wanting('assessor', false);

    const { end, reads } = await passedOnce(unwanted.consumer);

    expect([end, reads, unwanted.delivered, unwanted.asked]).toEqual(['caught_up', [false], [], [playbookKey]]);
  });

  it('is handed the records of its types when it wants them, read with their data', async () => {
    const wanted = wanting('assessor', true);

    const { reads } = await passedOnce(wanted.consumer);

    expect([reads, wanted.delivered, wanted.asked]).toEqual([[false, true], ['assessor record-1'], [playbookKey]]);
  });

  it('leaves the other consumers of the same types their records, as does a consumer that never says', async () => {
    const unwanted = wanting('assessor', false);
    const always = wanting('noting');

    const { reads } = await passedOnce(unwanted.consumer, always.consumer);

    expect([reads, unwanted.delivered, always.delivered]).toEqual([[false, true], [], ['noting record-1']]);
  });

  it('asks only the first of the consumers that want with the same answer, and hands the others that answer', async () => {
    const first = wanting('assessor', false, 'goal clocks');
    const second = wanting('notices seen', true, 'goal clocks');
    const own = wanting('own', true);

    const { reads } = await passedOnce(first.consumer, second.consumer, own.consumer);

    expect([reads, first.asked, second.asked, own.asked]).toEqual([[false, true], [playbookKey], [], [playbookKey]]);
    expect([first.delivered, second.delivered, own.delivered]).toEqual([[], [], ['own record-1']]);
  });
});

describe('a step over a record whose stepping has not worked out the consumers that want the playbook', () => {
  it('hands the record to every consumer given for its type', async () => {
    const always = wanting('noting');
    const stepping: Stepping = {
      playbookKey,
      gate: { verdictOn: () => Effect.succeed('passed') },
      mode: 'signal',
      delivered: () => new Set(['run_succeeded']),
      pageRead: Function.constVoid,
      readWithData: () => true,
      delivers: () => Effect.succeed(true),
      reactsTo: () => Effect.succeed(false),
      wantsMore: () => Effect.succeed(false),
      eventRead: ({ event }: FollowedRecord) => Effect.succeed({ event }),
    };
    const parts: StepParts = {
      consumers: [],
      registered: [always.consumer],
      calls: [],
      definitionType: 'workflow',
      applyDefinitionRecord: Function.constant(Effect.succeed('applied')),
      unreadable: Function.constant(Effect.void),
      contentMissing: Function.constant(Effect.void),
      passedEarly: Function.constant(Effect.void),
      holdsUnreadable: false,
    };

    await Effect.runPromise(
      stepOf(parts, stepping, { cursor: null, delivered: null, attempts: 0, waiting: false }, finishedAt(1)),
    );

    expect(always.delivered).toEqual(['noting record-1']);
  });
});
