import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { wantedTypesIn } from '../triggers/trigger-rows.ts';
import type { Consumer } from './consumers.ts';
import type { Mode } from './delivery-loop.ts';
import { followedEventRead, type FactPayloads } from './followed-events.ts';
import { recordTypesOf } from './playbook-records.ts';
import type { StepParts, Stepping } from './record-steps.ts';
import { runGateOf } from './run-gate.ts';

export interface SteppingParts extends Pick<StepParts, 'registered' | 'calls'> {
  readonly database: HostDatabase;
  readonly factPayloadsOf: FactPayloads;
}

interface WantedTypes {
  readonly reactedTo: ReadonlySet<string>;
  readonly delivered: ReadonlySet<string>;
  readonly registered: readonly Consumer[];
}

type Answers = Map<string, boolean>;

function wantedBy(consumer: Consumer, playbookKey: string, answers: Answers): Effect.Effect<boolean> {
  const { wants } = consumer;
  if (wants === undefined) {
    return Effect.succeed(true);
  }
  const asked = consumer.wantedWith ?? consumer.name;
  const known = answers.get(asked);
  return known === undefined
    ? Effect.map(wants(playbookKey), (answer) => {
        answers.set(asked, answer);
        return answer;
      })
    : Effect.succeed(known);
}

function registeredWanting(
  parts: SteppingParts,
  playbookKey: string,
  answers: Answers,
): Effect.Effect<readonly Consumer[]> {
  return Effect.filter(parts.registered, (consumer) => wantedBy(consumer, playbookKey, answers));
}

function wantedTypesOf(parts: SteppingParts, playbookKey: string, answers: Answers): Effect.Effect<WantedTypes> {
  return Effect.gen(function* () {
    const types = yield* wantedTypesIn(parts.database, playbookKey);
    const registered = yield* registeredWanting(parts, playbookKey, answers);
    return {
      reactedTo: new Set(types),
      delivered: new Set([
        ...recordTypesOf([...types, ...registered.flatMap((consumer) => consumer.types)]),
        ...parts.calls.flatMap((consumer) => consumer.types),
      ]),
      registered,
    };
  });
}

export function steppingOf(parts: SteppingParts, playbookKey: string, mode: Mode): Effect.Effect<Stepping> {
  const answers: Answers = new Map();
  return Effect.map(wantedTypesOf(parts, playbookKey, answers), (atStart) => {
    const known = { wanted: atStart, page: atStart.delivered, readSinceThePage: true };
    const refreshed = Effect.map(wantedTypesOf(parts, playbookKey, answers), (now) => {
      known.wanted = now;
      known.readSinceThePage = true;
      return now;
    });
    const naming = (namesOf: (wanted: WantedTypes) => ReadonlySet<string>) => (type: string) =>
      namesOf(known.wanted).has(type) || known.readSinceThePage
        ? Effect.succeed(namesOf(known.wanted).has(type))
        : Effect.map(refreshed, (now) => namesOf(now).has(type));
    return {
      playbookKey,
      gate: runGateOf(parts.database, playbookKey),
      mode,
      delivered: () => known.wanted.delivered,
      registered: () => known.wanted.registered,
      pageRead: (delivered) => {
        known.page = delivered;
        known.readSinceThePage = false;
      },
      readWithData: (type) => known.page.has(type),
      delivers: naming(({ delivered }) => delivered),
      reactsTo: naming(({ reactedTo }) => reactedTo),
      wantsMore: () => Effect.map(refreshed, (now) => [...now.delivered].some((type) => !known.page.has(type))),
      eventRead: ({ playbook, record, event }) => followedEventRead(record, event, parts.factPayloadsOf(playbook)),
    };
  });
}
