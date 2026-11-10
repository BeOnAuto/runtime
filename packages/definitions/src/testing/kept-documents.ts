import { sha256Of, type ContentOwner, type Digested, type RecordedContent } from '@on.auto/content';
import { payloadKept, textBytesOf, textPayloadText } from '@on.auto/operations/payloads';
import { Effect, Schema } from 'effect';

import type { PlaybookOperation } from '../operations/definition-operations.ts';
import { DefinitionEventSchema, type RecordedDefinitionEvent } from '../registry/definition-events.ts';
import { acmeAdmin } from './callers.ts';
import { harness, toPlaybook, type Harness } from './harness.ts';
import { watchedStore, type WatchedStore } from './kept-payloads.ts';
import {
  askingAbout,
  definitionFactsStored,
  functionDocumentLongerThanAFactHolds,
  savedPlaybook,
  savingAFunction,
  savingOperations,
} from './saved-definitions.ts';

export const keptFunctionName = 'greet-reasoning';

export const twoHoursLater = '2026-10-01T11:00:00.000Z';

export function keptArmOfText(text: string): Digested {
  return { sha256: sha256Of(text), bytes: textBytesOf(text) };
}

export function textKeptIn(content: Pick<RecordedContent, 'put'>, owner: ContentOwner, text: string) {
  const kept = keptArmOfText(text);
  return Effect.as(Effect.orDie(payloadKept(content, owner, { ...kept, ...textPayloadText(text) })), kept);
}

export interface KeepingPlaybook {
  readonly definitions: Harness;
  readonly watched: WatchedStore;
  readonly asked: ReturnType<typeof askingAbout>;
}

export function keepingPlaybook(): KeepingPlaybook {
  const watched = watchedStore();
  const definitions = harness(undefined, watched.store);
  return { definitions, watched, asked: askingAbout(definitions, savingAFunction.type, keptFunctionName, true) };
}

const decodeStored = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ type: Schema.String, data: Schema.Record(Schema.String, Schema.Json) })),
);

export async function definitionFactsOf(definitions: Harness) {
  return (await definitionFactsStored(definitions)).map((text) => decodeStored(text));
}

export async function runsStartedIn(definitions: Harness): Promise<number> {
  const { records } = await Effect.runPromise(
    definitions.ledger.service.readRecorded(savedPlaybook, { kind: 'everything' }, { order: 'asc', limit: 100 }),
  );
  return records.filter(({ type }) => type === 'run_started').length;
}

const toAlpha = toPlaybook(savedPlaybook.org, savedPlaybook.playbook);

const theKeptFunction = { type: savingAFunction.type, name: keptFunctionName };

export function askedAt(definitions: Harness, at: string) {
  return (operation: PlaybookOperation, input?: object) =>
    definitions.run(definitions.dispatch(operation, toAlpha(acmeAdmin, input ?? theKeptFunction)), at);
}

const decodeFact = Schema.decodeUnknownSync(Schema.toCodecJson(DefinitionEventSchema));

const keepingTheirTexts: ReadonlySet<string> = new Set([
  'definition_created',
  'definition_updated',
  'definition_restored',
]);

export async function definitionFactsWrittenKeepingTheirTexts(): Promise<readonly RecordedDefinitionEvent[]> {
  const { createDefinition, updateDefinition, retireDefinition, restoreDefinition } = savingOperations;
  const { first, second } = savingAFunction;
  const { definitions, asked } = keepingPlaybook();
  await asked(createDefinition, { ...first, source: functionDocumentLongerThanAFactHolds('Hi') });
  await asked(updateDefinition, {
    ...second,
    source: functionDocumentLongerThanAFactHolds('Hello'),
    overview: 'Greets each guest',
  });
  await asked(retireDefinition);
  await asked(restoreDefinition);
  const { records } = await Effect.runPromise(
    definitions.ledger.service.readRecorded(savedPlaybook, { kind: 'everything' }, { order: 'asc', limit: 100 }),
  );
  return records
    .filter(({ type }) => keepingTheirTexts.has(type))
    .map(({ type, data, context }) => decodeFact({ type, data, context }));
}
