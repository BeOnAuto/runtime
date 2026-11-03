import { Conflict, InvalidInput, PlaybookContext, type NotFound } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { definitionResourceLabel } from '../capability/function-terminology.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import type { ResultOver, SubjectPages } from '../page/subject-pages-port.ts';
import { isRetired, type StoredDefinition } from '../registry/definition.ts';
import { readDefinition } from './definition-reading.ts';
import { overOf, runOfThePage, runWithSample, viewsRead } from './page-runs.ts';
import { triggersSince } from './registry-access.ts';

interface DefinitionAsked {
  readonly type: string;
  readonly name: string;
  readonly render?: boolean;
  readonly sample_output?: Schema.Json;
  readonly run_id?: string;
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
  over: ResultOver,
  refusedWithoutAPage: MissingPageRefusal,
) {
  const label = definitionResourceLabel(type);
  if (isRetired(stored)) {
    return yield* retiredPage(label, stored.name);
  }
  if ((yield* pages.pageOf(type, stored.name)) === undefined) {
    return yield* refusedWithoutAPage({ label, name: stored.name });
  }
  return yield* pages.resultOf(type, stored.name, over);
});

const pageRead = Effect.fnUntraced(function* (
  reading: Reading,
  result: string | undefined,
  run?: Parameters<typeof viewsRead>[1],
) {
  const { pages, type, stored } = reading;
  const page = yield* pages.pageOf(type, stored.name);
  if (page === undefined) {
    return {};
  }
  const shown = { ...(result === undefined ? {} : { result }), ...(yield* viewsRead(reading, run)) };
  return Object.keys(shown).length === 0 ? {} : { page: shown };
});

function askedRightly({ render = false, sample_output: sample, run_id: runId }: DefinitionAsked) {
  if (sample === undefined) {
    return Effect.void;
  }
  if (!render) {
    return Effect.fail(sampleWithoutRender);
  }
  return runId === undefined ? Effect.void : Effect.fail(runWithSample);
}

export function definitionRead(
  capabilities: readonly Capability[],
  pages: SubjectPages,
  refusedWithoutAPage: MissingPageRefusal,
) {
  const known = knownCapabilities(capabilities);
  return Effect.fnUntraced(function* (asked: DefinitionAsked) {
    yield* askedRightly(asked);
    const { type, name, render = false, sample_output: sample, run_id: runId } = asked;
    const capability = yield* known.capabilityOfType(type);
    const { stored, definition: read } = yield* readDefinition(capability, known.types, name);
    const reading = { pages, type: capability.type, stored };
    const run = runId === undefined ? undefined : yield* runOfThePage(reading, runId);
    const result = render ? yield* resultOfAPreview(reading, overOf(sample, run), refusedWithoutAPage) : undefined;
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
      status: isRetired(definition) ? 'retired' : 'active',
      ...(stored.details === undefined ? {} : { details: stored.details }),
    });
    const page = yield* pageRead(reading, result, run);
    return { ...definition, ...(standing === undefined ? {} : { standing }), ...page };
  });
}
