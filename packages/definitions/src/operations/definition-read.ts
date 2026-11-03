import { Conflict, InvalidInput, PlaybookContext, type NotFound } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { definitionResourceLabel } from '../capability/function-terminology.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import type { SubjectPages } from '../page/subject-pages-port.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import { readDefinition } from './definition-reading.ts';
import { triggersSince } from './registry-access.ts';
import { viewsShownOf } from './saved-pages.ts';

interface DefinitionAsked {
  readonly type: string;
  readonly name: string;
  readonly render?: boolean;
  readonly sample_output?: Schema.Json;
}

export interface PageMissing {
  readonly label: string;
  readonly name: string;
}

type MissingPageRefusal = (missing: PageMissing) => InvalidInput | NotFound;

interface Reading {
  readonly pages: SubjectPages;
  readonly type: string;
  readonly stored: StoredDefinition;
}

function refusedAt(pointer: string, detail: string): InvalidInput {
  return new InvalidInput({ detail, issues: [{ pointer, detail }] });
}

const sampleWithoutRender = refusedAt(
  '/sample_output',
  'sample_output is read only with render: true; add render: true, or leave sample_output out',
);

function retiredPage(label: string, name: string): Conflict {
  return new Conflict({
    detail: `The ${label} ${name} is retired, and its page renders nowhere`,
    kind: 'retired',
  });
}

const resultOfAPreview = Effect.fnUntraced(function* (
  { pages, type, stored }: Reading,
  sample: Schema.Json | undefined,
  refusedWithoutAPage: MissingPageRefusal,
) {
  const label = definitionResourceLabel(type);
  if (stored.status === 'retired') {
    return yield* retiredPage(label, stored.name);
  }
  if ((yield* pages.pageOf(type, stored.name)) === undefined) {
    return yield* refusedWithoutAPage({ label, name: stored.name });
  }
  return yield* pages.resultOf(type, stored.name, sample === undefined ? { latest: true } : { sample });
});

const pageRead = Effect.fnUntraced(function* (reading: Reading, result: string | undefined) {
  const { pages, type, stored } = reading;
  const page = yield* pages.pageOf(type, stored.name);
  if (page === undefined) {
    return {};
  }
  const subject = { type, name: stored.name };
  const shown = {
    ...(result === undefined ? {} : { result }),
    ...viewsShownOf(yield* pages.latelyOf(subject), yield* pages.standingOf(subject)),
  };
  return Object.keys(shown).length === 0 ? {} : { page: shown };
});

export function definitionRead(
  capabilities: readonly Capability[],
  pages: SubjectPages,
  refusedWithoutAPage: MissingPageRefusal,
) {
  const known = knownCapabilities(capabilities);
  return Effect.fnUntraced(function* ({ type, name, render = false, sample_output: sample }: DefinitionAsked) {
    if (sample !== undefined && !render) {
      return yield* sampleWithoutRender;
    }
    const capability = yield* known.capabilityOfType(type);
    const { stored, definition: read } = yield* readDefinition(capability, known.types, name);
    const reading = { pages, type: capability.type, stored };
    const result = render ? yield* resultOfAPreview(reading, sample, refusedWithoutAPage) : undefined;
    const definition =
      (stored.triggers ?? []).length > 0 && stored.status === 'active'
        ? { ...read, triggers_since: yield* triggersSince(capability.type, stored) }
        : read;
    const { org, playbook } = yield* PlaybookContext;
    const standing = yield* capability.standing({
      org,
      playbook,
      name,
      version: definition.version,
      status: definition.status,
      ...(stored.details === undefined ? {} : { details: stored.details }),
    });
    const page = yield* pageRead(reading, result);
    return { ...definition, ...(standing === undefined ? {} : { standing }), ...page };
  });
}
