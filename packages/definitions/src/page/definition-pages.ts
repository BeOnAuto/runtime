import {
  Conflict,
  InvalidInput,
  PlaybookContext,
  type PlaybookAddress,
  type PlaybookReader,
} from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import type { DefinitionKind, Presenting } from '../capability/definition-kinds.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import { playbookShownOf, presentedPageOf, storedSubjectOf, subjectPageOf, subjectShownOf } from './page-reads.ts';
import type { PageShown } from './page-shown.ts';
import { latestRunOf } from './preview-runs.ts';
import { sampleRunOf } from './sample-runs.ts';

export interface PageAsked {
  readonly render?: boolean;
  readonly sample_output?: Schema.Json;
}

interface Reading {
  readonly capabilities: readonly DefinitionKind[];
  readonly capability: DefinitionKind;
  readonly stored: StoredDefinition;
}

type Read = Effect.Effect<{ readonly page?: PageShown }, InvalidInput | Conflict, PlaybookReader | PlaybookContext>;

function refusedAt(pointer: string, detail: string): InvalidInput {
  return new InvalidInput({ detail, issues: [{ pointer, detail }] });
}

function shownOrNot(shown: PageShown): { readonly page?: PageShown } {
  return Object.keys(shown).length === 0 ? {} : { page: shown };
}

const resultOfTheSubject = Effect.fnUntraced(function* (
  presents: Presenting,
  page: StoredDefinition,
  sample: Schema.Json | undefined,
) {
  const presented = presents.definitionPresentedBy(page.details);
  if (presented === undefined) {
    return { subject: playbookShownOf(yield* PlaybookContext), run: undefined };
  }
  const subject = yield* storedSubjectOf(presented.type, presented.name);
  const run =
    sample === undefined ? yield* latestRunOf(presented.type, presented.name) : yield* sampleRunOf(subject, sample);
  return { subject: subjectShownOf(presented.type, subject), run };
});

const previewOf = Effect.fnUntraced(function* (presents: Presenting, page: StoredDefinition, sample?: Schema.Json) {
  if (page.status === 'retired') {
    return yield* new Conflict({
      detail: `The page ${page.name} is retired and renders nowhere; save a new page to preview it`,
      kind: 'retired',
    });
  }
  const place: PlaybookAddress = yield* PlaybookContext;
  const { subject, run } = yield* resultOfTheSubject(presents, page, sample);
  const shown = presentedPageOf(page);
  const result = run === undefined ? undefined : yield* presents.resultOf(shown, run, subject);
  const lately = yield* presents.latelyOf(shown, subject, place);
  return shownOrNot({
    ...(result === undefined ? {} : { result }),
    ...(lately === undefined ? {} : { lately }),
  });
});

const latelyOfTheSubject = Effect.fnUntraced(function* (
  capabilities: readonly DefinitionKind[],
  type: string,
  stored: StoredDefinition,
) {
  const found = yield* subjectPageOf(capabilities, `${type}/${stored.name}`);
  if (found === undefined) {
    return {};
  }
  const lately = yield* found.presents.latelyOf(
    presentedPageOf(found.page),
    subjectShownOf(type, stored),
    yield* PlaybookContext,
  );
  return lately === undefined ? {} : { page: { lately } };
});

export function pageOfReading({ capabilities, capability, stored }: Reading, asked: PageAsked): Read {
  const { presents } = capability;
  if (asked.sample_output !== undefined && asked.render !== true) {
    return Effect.fail(
      refusedAt(
        '/sample_output',
        'sample_output is read only with render: true; add render: true, or leave sample_output out',
      ),
    );
  }
  if (presents === undefined) {
    return asked.render === true
      ? Effect.fail(refusedAt('/render', 'Only a page renders; render is for a definition of the type page'))
      : latelyOfTheSubject(capabilities, capability.type, stored);
  }
  return asked.render === true ? previewOf(presents, stored, asked.sample_output) : Effect.succeed({});
}
