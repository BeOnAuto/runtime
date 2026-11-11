import type { RecordedPage } from '@on.auto/operations';
import { Effect } from 'effect';

import { holdAfter, isHeldAt, type HoldParts, type PassReached } from '../holds/playbook-holds.ts';
import type { Mode } from './delivery-loop.ts';
import type { FollowedPlaybook, FollowedPlaybooks, Progress } from './followed-playbooks.ts';
import { steppingOf, type SteppingParts } from './pass-stepping.ts';
import { noRecordTypes, type PlaybookRecords } from './playbook-records.ts';
import { playbookOfKey, stepOf, type PassEnd, type Step, type StepParts, type Stepping } from './record-steps.ts';

export interface PassParts extends StepParts, HoldParts, SteppingParts {
  readonly records: Pick<PlaybookRecords, 'after'>;
  readonly playbooks: FollowedPlaybooks;
}

const pagesInAPass = 10;

type Ended = Step & { readonly end: PassEnd };

function reachedIn(page: RecordedPage, index: number, { end, held }: Ended, records: number): PassReached {
  const lag = { records: page.records.length - index, capped: page.hasMore };
  return held === undefined ? { end, records } : { end, records, held: { ...held, lag } };
}

function pagesPassed(
  parts: PassParts,
  stepping: Stepping,
  start: Progress,
  glance: RecordedPage | undefined,
): Effect.Effect<PassReached> {
  const { playbookKey } = stepping;
  return Effect.gen(function* () {
    let progress = start;
    let first = glance;
    let passed = 0;
    for (let pageRead = 0; pageRead < pagesInAPass; pageRead += 1) {
      const reading = first === undefined ? stepping.delivered() : noRecordTypes;
      const page = first ?? (yield* parts.records.after(playbookOfKey(playbookKey), progress.cursor, reading));
      first = undefined;
      stepping.pageRead(reading);
      for (const [index, record] of page.records.entries()) {
        const step = yield* stepOf(parts, stepping, progress, record);
        progress = step.progress;
        if (step.end !== undefined) {
          yield* parts.playbooks.save(playbookKey, progress);
          return reachedIn(page, index, { ...step, end: step.end }, passed);
        }
        passed += 1;
        if (step.delivered === true) {
          yield* parts.playbooks.save(playbookKey, progress);
        }
      }
      if (!page.hasMore) {
        yield* parts.playbooks.save(playbookKey, { ...progress, waiting: false });
        return { end: 'caught_up', records: passed };
      }
    }
    yield* parts.playbooks.save(playbookKey, { ...progress, waiting: true });
    return { end: 'more', records: passed };
  });
}

function reachedBy(parts: PassParts, mode: Mode, followed: FollowedPlaybook): Effect.Effect<PassReached> {
  const { playbookKey } = followed;
  return Effect.gen(function* () {
    const glance = yield* parts.records.after(playbookOfKey(playbookKey), followed.cursor, noRecordTypes);
    if (glance.records.length === 0 && !glance.hasMore) {
      return { end: 'caught_up', records: 0 };
    }
    const stepping = yield* steppingOf(parts, playbookKey, mode);
    return yield* pagesPassed(parts, stepping, followed, stepping.delivered().size === 0 ? glance : undefined);
  });
}

export function passOf(parts: PassParts) {
  return (playbookKey: string, mode: Mode, known?: FollowedPlaybook): Effect.Effect<PassEnd> =>
    Effect.gen(function* () {
      const followed = known ?? (yield* parts.playbooks.load(playbookKey));
      if (followed === undefined) {
        return 'caught_up';
      }
      if (isHeldAt(followed, parts.now()) || (followed.attempts > 0 && mode === 'signal')) {
        return 'waiting';
      }
      const reached = yield* reachedBy(parts, mode, followed);
      yield* holdAfter(parts, followed, reached);
      return reached.end;
    });
}
