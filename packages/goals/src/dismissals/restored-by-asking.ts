import { dismissalsName } from '@on.auto/activity';
import { RequestRecordSchema } from '@on.auto/definitions';
import {
  PlaybookContext,
  playbookCallerOf,
  playbookLedgerOf,
  recordedCallerOf,
  streamPrefixOfPlaybook,
  type PlaybookAddress,
  type RecordedEvent,
} from '@on.auto/operations';
import { callConsumerOf, type CallConsumer, type CallRecord } from '@on.auto/workflow-host';
import { Effect, Schema } from 'effect';

import { thingsAskedAboutOver } from '../asked-things/asked-things.ts';
import { deliveryDoing } from '../assessor/assessor-deliveries.ts';
import type { AssessorPorts } from '../assessor/run-planner.ts';
import { assessmentsKind } from '../goal-facts/goal-facts.ts';
import { restoringAsked } from './asked-again.ts';

const restoredByAskingName = 'dismissed things asked about again';

const mostStandingDismissalsSearched = 200;

const restoringSweeps = 20;

const asking = 'asked';

interface Asking {
  readonly run: string;
  readonly within: string;
  readonly at: number;
}

const isARequestAsked = Schema.is(Schema.Struct({ record: RequestRecordSchema }));

function askingOf({ data, context }: RecordedEvent): Asking | undefined {
  const { runId: run } = context;
  return run === undefined || !isARequestAsked(data)
    ? undefined
    : { run, within: context.calledBy?.runId ?? run, at: Date.parse(context.at) };
}

type RestoringPorts<E> = Pick<AssessorPorts<E>, 'ledger' | 'chainsOf' | 'now'>;

function dismissedBefore<E>(ports: RestoringPorts<E>, playbook: PlaybookAddress, asked: number) {
  return Effect.map(
    ports.ledger.readProjectedRows(dismissalsName, playbook, {
      where: [
        { column: 'dismissed', equals: true },
        { column: 'at', before: asked },
      ],
      orderBy: ['at'],
      order: 'desc',
      limit: mostStandingDismissalsSearched,
    }),
    (rows): ReadonlySet<string> => new Set(rows.map(({ key }) => key)),
  );
}

function restoreAskedAbout<E>(ports: RestoringPorts<E>, playbook: PlaybookAddress, asked: Asking) {
  return Effect.gen(function* () {
    const standing = yield* dismissedBefore(ports, playbook, asked.at);
    if (standing.size === 0) {
      return;
    }
    const about = thingsAskedAboutOver(ports.chainsOf(playbook), [[asked.within, asked.run]], {
      dismissed: 'include',
    });
    const [things = []] = yield* Effect.provideContext(
      Effect.provideService(about, PlaybookContext, playbook),
      playbookLedgerOf(ports.ledger, playbook),
    );
    const caller = playbookCallerOf(playbook);
    const at = ports.now();
    yield* Effect.forEach(
      things.filter(({ id }) => standing.has(id)),
      ({ id }) =>
        ports.ledger.execute(
          `${streamPrefixOfPlaybook(playbook)}${assessmentsKind}/${id}`,
          restoringAsked(caller.id, at),
          { asked: asked.at, at, by: recordedCallerOf(caller) },
        ),
      { discard: true },
    );
  });
}

export function restoredByAskingOf<E>(ports: RestoringPorts<E>): CallConsumer {
  return callConsumerOf({
    name: restoredByAskingName,
    types: ['run_deferred'],
    skippedAfterSweeps: restoringSweeps,
    readOf: (call: CallRecord) => call,
    batchOf: ({ playbook, record }, after) => {
      const asked = askingOf(record);
      const deliveries =
        asked === undefined || after !== undefined
          ? []
          : [deliveryDoing(asking, record.context.definitionName ?? '', restoreAskedAbout(ports, playbook, asked))];
      return Effect.succeed({ deliveries, through: undefined, more: false });
    },
  });
}
