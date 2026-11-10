import { PlaybookContext, type PlaybookAddress } from '@on.auto/operations';
import { Effect, Struct } from 'effect';

import { textAsRead } from '../payloads/kept-texts.ts';
import { pageResultOf, resultNamesTheOutput, type PlacedPage } from './page-presenting.ts';
import { playbookShownOf, subjectShownOf } from './page-reads.ts';
import { pageViewNameOf, playbookPageViewNameOf } from './page-view-names.ts';
import { presentedOf, writtenPlaybookPageOf, type Presented, type WrittenPage } from './presented-pages.ts';
import { runOfTheResult } from './result-runs.ts';
import { playbookSubject, type DefinitionSubject, type PageSubject, type ResultOver } from './subject-pages-port.ts';

function playbookPlaced(written: WrittenPage | undefined, place: PlaybookAddress): PlacedPage | undefined {
  return written === undefined
    ? undefined
    : {
        page: Struct.omit(written.page, ['source']),
        document: { text: written.page.source },
        written: written.written,
        of: 'playbook',
        view: playbookPageViewNameOf(place),
        place,
        subject: playbookShownOf(place),
      };
}

const definitionPlaced = Effect.fnUntraced(function* (
  subject: DefinitionSubject,
  presented: Presented,
  place: PlaybookAddress,
) {
  const placed: PlacedPage = {
    page: Struct.omit(presented.page, ['document']),
    document: yield* textAsRead('source', presented.page.document),
    written: presented.written,
    of: 'definition',
    view: pageViewNameOf(subject),
    place,
    subject: subjectShownOf(subject.type, presented.stored),
  };
  return placed;
});

export const placedOf = Effect.fnUntraced(function* (subject: PageSubject) {
  const place = yield* PlaybookContext;
  if (subject === playbookSubject) {
    return playbookPlaced(yield* writtenPlaybookPageOf(), place);
  }
  const presented = yield* presentedOf(subject.type, subject.name);
  return presented === undefined ? presented : yield* definitionPlaced(subject, presented, place);
});

const resultOfThePage = Effect.fnUntraced(function* (type: string, presented: Presented, over: ResultOver) {
  const { page, written, stored } = presented;
  const document = yield* textAsRead('source', page.document);
  const placed = { document, written, of: 'definition' as const, subject: subjectShownOf(type, stored) };
  const run = yield* runOfTheResult(type, presented, over, resultNamesTheOutput(placed));
  return run === undefined ? undefined : yield* pageResultOf(placed, run);
});

export const resultOf = Effect.fnUntraced(function* (type: string, name: string, over: ResultOver) {
  const presented = yield* presentedOf(type, name);
  return presented === undefined ? undefined : yield* resultOfThePage(type, presented, over);
});
