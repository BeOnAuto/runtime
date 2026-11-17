import { playbookRowsOf, type PlaybookAddress } from '@on.auto/operations';
import type { DueItem, DueWork } from '@on.auto/workflow-host';
import { Effect } from 'effect';

import { contributedVersionsOf } from '../assessor/contributed-versions.ts';
import type { AssessorPorts } from '../assessor/run-planner.ts';
import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { caughtUp, type CatchUpParts } from './caught-up-stops.ts';

const stoppedCatchUpName = 'the stopped things of the goals caught up';

const mostOpenThingsListed = 1_000;

function playbooksWithOpenThings(parts: CatchUpParts<unknown>) {
  return Effect.map(
    parts.ledger.readDueRows(assessmentsName, {
      column: 'judging_due_at',
      through: Number.MAX_SAFE_INTEGER,
      limit: mostOpenThingsListed,
    }),
    (rows): readonly PlaybookAddress[] => {
      const keyed = new Map(
        playbookRowsOf(assessmentsName, rows).map(({ org, playbook }) => [`${org}/${playbook}`, { org, playbook }]),
      );
      return [...keyed.values()];
    },
  );
}

export function stoppedCatchUpOf<E>(ports: AssessorPorts<E>): DueWork {
  const parts: CatchUpParts<E> = { ...ports, versions: contributedVersionsOf() };
  const known: { listed?: readonly PlaybookAddress[] } = {};
  const caught = new Set<string>();
  const itemOf = (playbook: PlaybookAddress): DueItem => {
    const key = `${playbook.org}/${playbook.playbook}/${stoppedCatchUpName}`;
    return {
      key,
      callsOut: false,
      perform: () =>
        Effect.map(caughtUp(parts, playbook), () => {
          caught.add(key);
        }),
    };
  };
  const listed = Effect.suspend(() =>
    known.listed === undefined
      ? Effect.map(playbooksWithOpenThings(parts), (playbooks) => {
          known.listed = playbooks;
          return playbooks;
        })
      : Effect.succeed(known.listed),
  );
  return {
    name: stoppedCatchUpName,
    due: (_now, most, callsOut) =>
      callsOut
        ? Effect.succeed([])
        : Effect.map(listed, (playbooks) =>
            playbooks
              .map((playbook) => itemOf(playbook))
              .filter(({ key }) => !caught.has(key))
              .slice(0, most),
          ),
    nextDueAt: () => Effect.succeed(null),
  };
}
