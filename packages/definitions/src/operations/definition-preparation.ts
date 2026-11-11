import { Conflict } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Capability, PreparedDefinition } from '../capability/capability.ts';
import { definitionResourceLabel } from '../capability/function-terminology.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import { findDefinition } from '../registry/registry-lookup.ts';
import { sourceToPrepare } from './definition-views.ts';
import type { Rejection } from './issue-pointers.ts';
import { loadRegistry, versionOf } from './registry-access.ts';
import { documentToRun, isDocumentLost, type DocumentLoss } from './unread-texts.ts';

const refusalsToRun = {
  retired: (label: string, name: string) =>
    new Conflict({ detail: `The ${label} ${name} is retired and can no longer be run`, kind: 'retired' }),
  paused: (label: string, name: string) =>
    new Conflict({ detail: `The ${label} ${name} is paused and starts no runs until it is resumed`, kind: 'paused' }),
};

const runnableDefinition = Effect.fnUntraced(function* (type: string, name: string) {
  const definition = yield* findDefinition(yield* loadRegistry(type), type, name);
  const { status } = definition;
  return status === 'active' ? definition : yield* refusalsToRun[status](definitionResourceLabel(type), name);
});

export const pausedRefusalOf = Effect.fnUntraced(function* (type: string, name: string) {
  const { status } = yield* findDefinition(yield* loadRegistry(type), type, name);
  return status === 'paused' ? refusalsToRun.paused(definitionResourceLabel(type), name) : undefined;
});

function unparseable(
  type: string,
  { name, version }: Pick<StoredDefinition, 'name' | 'version'>,
): (rejection: Rejection) => Conflict {
  return ({ detail }) =>
    new Conflict({
      detail: `The ${definitionResourceLabel(type)} ${name} at version ${version} no longer parses (${detail}); update it`,
      kind: 'unworkable',
    });
}

export interface VersionToRun {
  readonly name: string;
  readonly version: number;
}

type VersionAsRecorded = Parameters<typeof documentToRun>[1] & {
  readonly stripped?: Parameters<Capability['prepare']>[1];
};

const preparedOf = Effect.fnUntraced(function* (capability: Capability, definition: VersionAsRecorded) {
  const source = yield* documentToRun(capability.type, definition);
  return yield* capability
    .prepare(sourceToPrepare(capability.type, source), definition.stripped)
    .pipe(Effect.mapError(unparseable(capability.type, definition)));
});

export const preparedDefinition = Effect.fnUntraced(function* (capability: Capability, name: string) {
  const definition = yield* runnableDefinition(capability.type, name);
  return { definition, prepared: yield* preparedOf(capability, definition) };
});

export const preparedVersion = Effect.fnUntraced(function* (capability: Capability, name: string, version: number) {
  const definition = yield* versionOf(capability.type, name, version);
  return { definition, prepared: yield* preparedOf(capability, definition) };
});

interface VersionPrepared {
  readonly definition: VersionToRun;
  readonly prepared: PreparedDefinition;
}

export type VersionToResume =
  | { readonly toRun: VersionPrepared }
  | { readonly lost: DocumentLoss; readonly definition: VersionToRun };

const resumableVersion = Effect.fnUntraced(function* (capability: Capability, name: string, version: number) {
  const resumable: VersionToResume = { toRun: yield* preparedVersion(capability, name, version) };
  return resumable;
});

function lostVersionOf(definition: VersionToRun) {
  return ({ detail, because }: DocumentLoss) =>
    Effect.succeed<VersionToResume>({ lost: { detail, because }, definition });
}

export function versionToResume(capability: Capability, name: string, version: number) {
  return Effect.catchIf(resumableVersion(capability, name, version), isDocumentLost, lostVersionOf({ name, version }));
}
