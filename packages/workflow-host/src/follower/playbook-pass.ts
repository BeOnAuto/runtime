import type { RecordedPage } from '@on.auto/operations';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { wantedTypesIn } from '../triggers/trigger-rows.ts';
import type { Mode } from './delivery-loop.ts';
import type { FollowedPlaybook, FollowedPlaybooks, Progress } from './followed-playbooks.ts';
import { noRecordTypes, recordTypesOf, type PlaybookRecords } from './playbook-records.ts';
import { playbookOfKey, stepOf, type PassEnd, type StepParts, type Stepping } from './record-steps.ts';
import { runGateOf } from './run-gate.ts';

export interface PassParts extends StepParts {
  readonly database: HostDatabase;
  readonly records: Pick<PlaybookRecords, 'after'>;
  readonly playbooks: FollowedPlaybooks;
}

const pagesInAPass = 10;

function pagesPassed(
  parts: PassParts,
  stepping: Stepping,
  start: Progress,
  glance: RecordedPage | undefined,
): Effect.Effect<PassEnd> {
  const { playbookKey } = stepping;
  return Effect.gen(function* () {
    let progress = start;
    let first = glance;
    for (let page = 0; page < pagesInAPass; page += 1) {
      const reading = first === undefined ? stepping.delivered() : noRecordTypes;
      const { records, hasMore } =
        first ?? (yield* parts.records.after(playbookOfKey(playbookKey), progress.cursor, reading));
      first = undefined;
      stepping.pageRead(reading);
      for (const record of records) {
        const step = yield* stepOf(parts, stepping, progress, record);
        progress = step.progress;
        if (step.end !== undefined) {
          yield* parts.playbooks.save(playbookKey, progress);
          return step.end;
        }
        if (step.delivered === true) {
          yield* parts.playbooks.save(playbookKey, progress);
        }
      }
      if (!hasMore) {
        yield* parts.playbooks.save(playbookKey, { ...progress, waiting: false });
        return 'caught_up';
      }
    }
    yield* parts.playbooks.save(playbookKey, { ...progress, waiting: true });
    return 'more';
  });
}

interface WantedTypes {
  readonly reactedTo: ReadonlySet<string>;
  readonly delivered: ReadonlySet<string>;
}

function wantedTypesOf(parts: PassParts, playbookKey: string): Effect.Effect<WantedTypes> {
  return Effect.map(wantedTypesIn(parts.database, playbookKey), (types) => ({
    reactedTo: new Set(types),
    delivered: new Set([
      ...recordTypesOf([...types, ...parts.registered.flatMap((consumer) => consumer.types)]),
      ...parts.calls.flatMap((consumer) => consumer.types),
    ]),
  }));
}

function steppingOf(parts: PassParts, playbookKey: string, mode: Mode): Effect.Effect<Stepping> {
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
    };
  });
}

export function passOf(parts: PassParts) {
  return (playbookKey: string, mode: Mode, known?: FollowedPlaybook): Effect.Effect<PassEnd> =>
    Effect.gen(function* () {
      const followed = known ?? (yield* parts.playbooks.load(playbookKey));
      if (followed === undefined) {
        return 'caught_up';
      }
      if (followed.attempts > 0 && mode === 'signal') {
        return 'waiting';
      }
      const glance = yield* parts.records.after(playbookOfKey(playbookKey), followed.cursor, noRecordTypes);
      if (glance.records.length === 0 && !glance.hasMore) {
        return 'caught_up';
      }
      const stepping = yield* steppingOf(parts, playbookKey, mode);
      return yield* pagesPassed(parts, stepping, followed, stepping.delivered().size === 0 ? glance : undefined);
    });
}
