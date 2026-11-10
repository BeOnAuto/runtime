import { PlaybookContext, type InvalidInput, type PlaybookAddress, type PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { pageResultOf, resultNamesTheOutput, type PlacedPage } from './page-presenting.ts';
import { playbookShownOf, subjectShownOf } from './page-reads.ts';
import type { RunShown } from './page-rendering.ts';
import { pageViewNameOf, playbookPageViewNameOf } from './page-view-names.ts';
import { presentedOf, writtenPlaybookPageOf, type Presented, type WrittenPage } from './presented-pages.ts';
import { givenRunShown, latestRunOf } from './preview-runs.ts';
import { sampleRunOf } from './sample-runs.ts';
import { playbookSubject, type DefinitionSubject, type PageSubject, type ResultOver } from './subject-pages-port.ts';

type ReadInPlace<A, E = never> = Effect.Effect<A, E, PlaybookReader | PlaybookContext>;

function playbookPlaced(written: WrittenPage | undefined, place: PlaybookAddress): PlacedPage | undefined {
  return written === undefined
    ? undefined
    : { ...written, of: 'playbook', view: playbookPageViewNameOf(place), place, subject: playbookShownOf(place) };
}

function definitionPlaced(
  subject: DefinitionSubject,
  presented: Presented | undefined,
  place: PlaybookAddress,
): PlacedPage | undefined {
  return presented === undefined
    ? undefined
    : {
        page: presented.page,
        written: presented.written,
        of: 'definition',
        view: pageViewNameOf(subject),
        place,
        subject: subjectShownOf(subject.type, presented.stored),
      };
}

export const placedOf = Effect.fnUntraced(function* (subject: PageSubject) {
  const place = yield* PlaybookContext;
  return subject === playbookSubject
    ? playbookPlaced(yield* writtenPlaybookPageOf(), place)
    : definitionPlaced(subject, yield* presentedOf(subject.type, subject.name), place);
});

function runOver(
  type: string,
  { stored }: Presented,
  over: ResultOver,
  readsOutput: boolean,
): ReadInPlace<RunShown | undefined, InvalidInput> {
  if ('run' in over) {
    return givenRunShown(over, readsOutput);
  }
  return 'sample' in over ? sampleRunOf(stored, over.sample) : latestRunOf(type, stored.name, readsOutput);
}

const resultOfThePage = Effect.fnUntraced(function* (type: string, presented: Presented, over: ResultOver) {
  const { page, written, stored } = presented;
  const placed = { page, written, of: 'definition' as const, subject: subjectShownOf(type, stored) };
  const run = yield* runOver(type, presented, over, resultNamesTheOutput(placed));
  return run === undefined ? undefined : yield* pageResultOf(placed, run);
});

export const resultOf = Effect.fnUntraced(function* (type: string, name: string, over: ResultOver) {
  const presented = yield* presentedOf(type, name);
  return presented === undefined ? undefined : yield* resultOfThePage(type, presented, over);
});
