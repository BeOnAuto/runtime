import type { LedgerStreams } from '@on.auto/ledger';
import { cursorWithin, type RecordedEvent, type RecordedPage } from '@on.auto/operations';
import { Effect } from 'effect';

import { heldAfter, heldAgain, type HeldAtARecord, type HoldParts, type PassReached } from '../holds/playbook-holds.ts';
import type { Mode } from './delivery-loop.ts';
import type { FollowedOrg, FollowedOrgs, HeldPlaybook, Progress } from './followed-orgs.ts';
import { playbooksOfRecords, type OrgRecords, type PlaybookOfARecord } from './org-records.ts';
import { steppingOf, type SteppingParts } from './pass-stepping.ts';
import { noRecordTypes } from './playbook-records.ts';
import { passedOver, stepOf, type PassEnd, type Step, type StepParts, type Stepping } from './record-steps.ts';

export interface PassParts extends StepParts, HoldParts, SteppingParts {
  readonly records: OrgRecords;
  readonly orgs: FollowedOrgs;
  readonly names: Pick<LedgerStreams, 'nameHeldBy'>;
}

export interface Passes {
  readonly org: (org: string, mode: Mode, known?: FollowedOrg) => Effect.Effect<PassEnd>;
  readonly held: (held: HeldPlaybook) => Effect.Effect<PassEnd>;
}

const pagesInAPass = 10;

function heldOf(step: Step, record: RecordedEvent, page: RecordedPage, index: number): HeldAtARecord {
  return {
    heldFor: step.held?.heldFor ?? 'delivery',
    record: { id: record.id, type: record.type },
    lag: { records: page.records.length - index, capped: page.hasMore },
  };
}

function atTheRecord(progress: Progress, record: RecordedEvent): Progress {
  return { ...progress, cursor: cursorWithin(record.cursor, 0) };
}

interface Steppings {
  readonly of: (playbookKey: string) => Effect.Effect<Stepping>;
  readonly reading: () => ReadonlySet<string>;
  readonly pageRead: (reading: ReadonlySet<string>) => void;
}

function steppingsOf(parts: PassParts, mode: Mode): Steppings {
  const made = new Map<string, Stepping>();
  const page = { read: noRecordTypes };
  return {
    of: (playbookKey) => {
      const known = made.get(playbookKey);
      return known === undefined
        ? Effect.map(steppingOf(parts, playbookKey, mode), (stepping) => {
            stepping.pageRead(page.read);
            made.set(playbookKey, stepping);
            return stepping;
          })
        : Effect.succeed(known);
    },
    reading: () => {
      const types = new Set<string>();
      for (const stepping of made.values()) {
        for (const type of stepping.delivered()) {
          types.add(type);
        }
      }
      return types;
    },
    pageRead: (reading) => {
      page.read = reading;
      for (const stepping of made.values()) {
        stepping.pageRead(reading);
      }
    },
  };
}

interface OrgPassing {
  readonly org: string;
  readonly steppings: Steppings;
  readonly playbookOf: PlaybookOfARecord;
  readonly parked: Set<string>;
}

interface PageAt {
  readonly page: RecordedPage;
  readonly index: number;
}

function followedPlaybookOf(passing: OrgPassing, record: RecordedEvent): Effect.Effect<string | undefined> {
  return Effect.map(passing.playbookOf(record), (playbookKey) =>
    playbookKey === undefined || passing.parked.has(playbookKey) ? undefined : playbookKey,
  );
}

function orgStepOf(
  parts: PassParts,
  passing: OrgPassing,
  progress: Progress,
  { page, index }: PageAt,
): (record: RecordedEvent) => Effect.Effect<Step> {
  return (record) =>
    Effect.gen(function* () {
      const playbookKey = yield* followedPlaybookOf(passing, record);
      if (playbookKey === undefined) {
        return { progress: passedOver(record) };
      }
      const step = yield* stepOf(parts, yield* passing.steppings.of(playbookKey), progress, record);
      if (step.end !== 'waiting') {
        return step;
      }
      passing.parked.add(playbookKey);
      const held = heldOf(step, record, page, index);
      const parking = { playbookKey, org: passing.org, hold: undefined };
      yield* heldAgain(parts, parking, { progress: atTheRecord(step.progress, record), records: 0, held });
      return { progress: passedOver(record), delivered: true };
    });
}

function orgPagesPassed(
  parts: PassParts,
  passing: OrgPassing,
  start: Progress,
  glance: RecordedPage | undefined,
): Effect.Effect<PassEnd> {
  const { org } = passing;
  return Effect.gen(function* () {
    let progress = start;
    let first = glance;
    for (let pageRead = 0; pageRead < pagesInAPass; pageRead += 1) {
      const reading = first === undefined ? passing.steppings.reading() : noRecordTypes;
      const page = first ?? (yield* parts.records.after(org, progress.cursor, reading));
      first = undefined;
      passing.steppings.pageRead(reading);
      for (const [index, record] of page.records.entries()) {
        const step = yield* orgStepOf(parts, passing, progress, { page, index })(record);
        progress = step.progress;
        if (step.end !== undefined) {
          yield* parts.orgs.save(org, progress);
          return step.end;
        }
        if (step.delivered === true) {
          yield* parts.orgs.save(org, progress);
        }
      }
      if (!page.hasMore) {
        yield* parts.orgs.save(org, { ...progress, waiting: false });
        return 'caught_up';
      }
    }
    yield* parts.orgs.save(org, { ...progress, waiting: true });
    return 'more';
  });
}

function primedBy(passing: OrgPassing, glance: RecordedPage): Effect.Effect<void> {
  return Effect.forEach(
    glance.records,
    (record) =>
      Effect.flatMap(followedPlaybookOf(passing, record), (playbookKey) =>
        playbookKey === undefined ? Effect.void : Effect.asVoid(passing.steppings.of(playbookKey)),
      ),
    { discard: true },
  );
}

function orgPassOf(parts: PassParts): Passes['org'] {
  return (org, mode, known) =>
    Effect.gen(function* () {
      const followed = known ?? (yield* parts.orgs.load(org));
      if (followed === undefined) {
        return 'caught_up';
      }
      const glance = yield* parts.records.after(org, followed.cursor, noRecordTypes);
      if (glance.records.length === 0 && !glance.hasMore) {
        return 'caught_up';
      }
      const passing: OrgPassing = {
        org,
        steppings: steppingsOf(parts, mode),
        playbookOf: playbooksOfRecords(parts.names),
        parked: new Set(yield* parts.orgs.heldIn(org)),
      };
      yield* primedBy(passing, glance);
      const first = passing.steppings.reading().size === 0 ? glance : undefined;
      return yield* orgPagesPassed(parts, passing, followed, first);
    });
}

function reachedAt(
  step: Step & { readonly end: PassEnd },
  record: RecordedEvent,
  at: PageAt,
  records: number,
): PassReached {
  return step.end === 'waiting'
    ? {
        end: step.end,
        records,
        progress: atTheRecord(step.progress, record),
        held: heldOf(step, record, at.page, at.index),
      }
    : { end: step.end, records, progress: step.progress };
}

interface HeldStepping {
  readonly held: HeldPlaybook;
  readonly stepping: Stepping;
  readonly playbookOf: PlaybookOfARecord;
}

type HeldStep = { readonly progress: Progress; readonly stepped: boolean } | { readonly reached: PassReached };

function heldStepOf(
  parts: PassParts,
  { held, stepping, playbookOf }: HeldStepping,
  progress: Progress,
  at: PageAt & { readonly records: number },
): (record: RecordedEvent) => Effect.Effect<HeldStep> {
  return (record) =>
    Effect.gen(function* () {
      if ((yield* playbookOf(record)) !== held.playbookKey) {
        return { progress: passedOver(record), stepped: false };
      }
      const step = yield* stepOf(parts, stepping, progress, record);
      if (step.end !== undefined) {
        return { reached: reachedAt({ ...step, end: step.end }, record, at, at.records) };
      }
      yield* step.delivered === true ? parts.orgs.parked({ ...held, progress: step.progress }) : Effect.void;
      return { progress: step.progress, stepped: true };
    });
}

function heldPagesPassed(parts: PassParts, held: HeldPlaybook, through: string): Effect.Effect<PassReached> {
  const { playbookKey, org } = held;
  return Effect.gen(function* () {
    const stepping = yield* steppingOf(parts, playbookKey, 'sweep');
    const holding: HeldStepping = { held, stepping, playbookOf: playbooksOfRecords(parts.names) };
    let progress: Progress = held.progress;
    let records = 0;
    for (let pageRead = 0; pageRead < pagesInAPass; pageRead += 1) {
      const reading = stepping.delivered();
      const page = yield* parts.records.after(org, progress.cursor, reading, through);
      stepping.pageRead(reading);
      for (const [index, record] of page.records.entries()) {
        const step = yield* heldStepOf(parts, holding, progress, { page, index, records })(record);
        if ('reached' in step) {
          return step.reached;
        }
        progress = step.progress;
        records += step.stepped ? 1 : 0;
      }
      if (!page.hasMore) {
        return { end: 'caught_up', records, progress };
      }
    }
    return { end: 'more', records, progress };
  });
}

function heldPassOf(parts: PassParts): Passes['held'] {
  return (held) =>
    Effect.gen(function* () {
      const through = (yield* parts.orgs.load(held.org))?.cursor ?? null;
      const reached: PassReached =
        through === null
          ? { end: 'caught_up', records: 0, progress: held.progress }
          : yield* heldPagesPassed(parts, held, through);
      yield* heldAfter(parts, held, reached);
      return reached.end;
    });
}

export function passesOf(parts: PassParts): Passes {
  return { org: orgPassOf(parts), held: heldPassOf(parts) };
}
