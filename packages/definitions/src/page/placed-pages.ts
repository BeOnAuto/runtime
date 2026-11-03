import { PlaybookContext, type InvalidInput, type PlaybookAddress, type PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { pageResultOf, type PlacedPage } from './page-presenting.ts';
import { playbookShownOf, runShownOf, subjectShownOf } from './page-reads.ts';
import type { RunShown } from './page-rendering.ts';
import { pageViewNameOf, playbookPageViewNameOf } from './page-view-names.ts';
import { presentedOf, writtenPlaybookPageOf, type Presented, type WrittenPage } from './presented-pages.ts';
import { latestRunOf } from './preview-runs.ts';
import { sampleRunOf } from './sample-runs.ts';
import { playbookSubject, type DefinitionSubject, type PageSubject, type ResultOver } from './subject-pages-port.ts';

type Read<A, E = never> = Effect.Effect<A, E, PlaybookReader>;

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

function runOver(type: string, { stored }: Presented, over: ResultOver): Read<RunShown | undefined, InvalidInput> {
  if ('run' in over) {
    return Effect.succeed(runShownOf(over.run));
  }
  return 'sample' in over ? sampleRunOf(stored, over.sample) : latestRunOf(type, stored.name);
}

function resultOver(type: string, { page, written, stored }: Presented, run: RunShown | undefined) {
  return run === undefined
    ? Effect.undefined
    : pageResultOf({ page, written, of: 'definition', subject: subjectShownOf(type, stored) }, run);
}

export const resultOf = Effect.fnUntraced(function* (type: string, name: string, over: ResultOver) {
  const presented = yield* presentedOf(type, name);
  return presented === undefined
    ? undefined
    : yield* resultOver(type, presented, yield* runOver(type, presented, over));
});
