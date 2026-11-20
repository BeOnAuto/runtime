import { Effect } from 'effect';

import type { WrittenDefinition } from '../operations/definition-views.ts';
import { refusedToAnswerFor } from '../operations/unread-texts.ts';
import { writtenInOf } from '../page/page-lines.ts';
import { textsRead } from '../payloads/kept-texts.ts';
import { definitionSubject } from '../used-by/definitions-named.ts';
import { filtersOnItsRuns, pageFiltersOf, type RenameMember, type Renaming } from './rename-members.ts';
import { renamedIn, type TextRenamed } from './renamed-yaml.ts';

const pageFilters = '/page/data/source/events';

function textsRenamed({ named, stored }: RenameMember, renaming: Renaming) {
  const { type, from, to } = renaming;
  const subject = { from: definitionSubject(type, from), to: definitionSubject(type, to) };
  const names = named.names
    .filter((written) => written.type === type && written.name === from)
    .map(({ pointer }): TextRenamed => ({ pointer, from, to }));
  const subjects = [...named.subjects, ...named.awaited]
    .filter((written) => filtersOnItsRuns(written, renaming))
    .map(({ pointer }): TextRenamed => ({ pointer, from: subject.from, to: subject.to }));
  const pages = pageFiltersOf(stored).flatMap((filter, index): readonly TextRenamed[] =>
    filtersOnItsRuns(filter, renaming)
      ? [{ pointer: `${pageFilters}/${index}/subject`, from: subject.from, to: subject.to }]
      : [],
  );
  return [...names, ...subjects, ...pages];
}

export const renamedTexts = Effect.fnUntraced(function* (member: RenameMember, renaming: Renaming) {
  const { type, stored } = member;
  const texts = yield* textsRead(stored).pipe(Effect.mapError(refusedToAnswerFor(type, stored)));
  const written: WrittenDefinition = {
    ...texts,
    source: renamedIn(texts.source, writtenInOf(type), textsRenamed(member, renaming)),
  };
  return written.source === texts.source ? undefined : written;
});
