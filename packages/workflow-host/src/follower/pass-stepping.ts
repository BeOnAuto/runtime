import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { wantedTypesIn } from '../triggers/trigger-rows.ts';
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
}

function wantedTypesOf(parts: SteppingParts, playbookKey: string): Effect.Effect<WantedTypes> {
  return Effect.map(wantedTypesIn(parts.database, playbookKey), (types) => ({
    reactedTo: new Set(types),
    delivered: new Set([
      ...recordTypesOf([...types, ...parts.registered.flatMap((consumer) => consumer.types)]),
      ...parts.calls.flatMap((consumer) => consumer.types),
    ]),
  }));
}

export function steppingOf(parts: SteppingParts, playbookKey: string, mode: Mode): Effect.Effect<Stepping> {
  return Effect.map(wantedTypesOf(parts, playbookKey), (atStart) => {
    const known = { wanted: atStart, page: atStart.delivered, readSinceThePage: true };
    const refreshed = Effect.map(wantedTypesOf(parts, playbookKey), (now) => {
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
