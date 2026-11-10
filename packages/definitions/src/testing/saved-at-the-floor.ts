import { mostShownFieldBytes, type Decider } from '@on.auto/operations';
import { textBytesOf } from '@on.auto/operations/payloads';
import { Effect, Result, Schema } from 'effect';

import { textMemberNames } from '../payloads/definition-texts.ts';
import {
  DefinitionEventSchema,
  type DefinitionEvent,
  type RecordedDefinitionEvent,
} from '../registry/definition-events.ts';
import { harness, type Harness } from './harness.ts';
import { keptFunctionName, textKeptIn } from './kept-documents.ts';
import {
  askingAbout,
  definitionFactsStored,
  savedPlaybook,
  savingAFunction,
  savingOperations,
  type SavedTexts,
} from './saved-definitions.ts';

const theFloorOfTheThreshold = mostShownFieldBytes;

interface FactGiven {
  readonly fact: DefinitionEvent;
  readonly context: RecordedDefinitionEvent['context'];
}

const givenAsItIs: Decider<undefined, FactGiven, RecordedDefinitionEvent> = {
  initialState: undefined,
  evolve: () => {},
  decide: ({ fact }) => Result.succeed([fact]),
  context: ({ context }) => context,
  eventSchema: DefinitionEventSchema,
};

const recordedFactOf = Schema.decodeUnknownSync(Schema.toCodecJson(DefinitionEventSchema));

const dataAsRecorded = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json));

const contentOf = Schema.decodeUnknownSync(Schema.Struct({ content: Schema.optionalKey(Schema.JsonObject) }));

const inlineTextsOf = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.String));

const isATextMember: ReadonlySet<string> = new Set(textMemberNames);

type Member = readonly [string, Schema.Json];

function membersAtTheFloor(definitions: Harness, [name, text]: readonly [string, string]) {
  return textBytesOf(text) > theFloorOfTheThreshold
    ? Effect.map(
        textKeptIn(definitions.ledger.service.content, savedPlaybook, text),
        ({ sha256, bytes }): readonly Member[] => [
          [`${name}_sha256`, sha256],
          [`${name}_bytes`, bytes],
        ],
      )
    : Effect.succeed<readonly Member[]>([[name, text]]);
}

type Entry = readonly [string, Schema.Json];

type Text = readonly [string, string];

function isAText([name]: Entry): boolean {
  return isATextMember.has(name);
}

function isNoText([name]: Entry): boolean {
  return !isATextMember.has(name);
}

function contentAtTheFloor(definitions: Harness, content: Schema.JsonObject): Effect.Effect<Schema.JsonObject> {
  const entries: readonly Entry[] = Object.entries(content);
  const texts: readonly Text[] = Object.entries(
    inlineTextsOf(Object.fromEntries(entries.filter((entry) => isAText(entry)))),
  );
  return Effect.map(
    Effect.forEach(texts, (text: Text) => membersAtTheFloor(definitions, text)),
    (members: readonly (readonly Member[])[]) =>
      Object.fromEntries([...entries.filter((entry) => isNoText(entry)), ...members.flat()]),
  );
}

interface RecordedAsJson {
  readonly type: string;
  readonly data: unknown;
  readonly context: unknown;
}

function factAtTheFloor(definitions: Harness, { type, data, context }: RecordedAsJson) {
  const recorded = dataAsRecorded(data);
  const { content } = contentOf(recorded);
  const atTheFloor =
    content === undefined
      ? Effect.succeed(recorded)
      : Effect.map(contentAtTheFloor(definitions, content), (kept) => ({ ...recorded, content: kept }));
  return Effect.map(atTheFloor, (keptData) => recordedFactOf({ type, data: keptData, context }));
}

function recordedAsItIs(definitions: Harness, stream: string, { context, ...fact }: RecordedDefinitionEvent) {
  return Effect.orDie(definitions.ledger.service.execute(stream, givenAsItIs, { fact, context }));
}

async function savedAtTheFloor(definitions: Harness, saving: (elsewhere: Harness) => Promise<unknown>): Promise<void> {
  const elsewhere = harness();
  await saving(elsewhere);
  const { records } = await Effect.runPromise(
    elsewhere.ledger.service.readRecorded(savedPlaybook, { kind: 'everything' }, { order: 'asc', limit: 100 }),
  );
  await definitions.run(
    Effect.forEach(
      records.filter(({ stream }) => stream.includes('/definitions/')),
      (record) =>
        Effect.andThen(factAtTheFloor(definitions, record), (fact) => recordedAsItIs(definitions, record.stream, fact)),
      { discard: true },
    ),
  );
}

export function createdAtTheFloor(definitions: Harness, texts: SavedTexts): Promise<void> {
  return savedAtTheFloor(definitions, (elsewhere) =>
    askingAbout(elsewhere, savingAFunction.type, keptFunctionName)(savingOperations.createDefinition, texts),
  );
}

export async function definitionFactsStoredAtTheFloor(): Promise<readonly string[]> {
  const definitions = harness();
  await savedAtTheFloor(definitions, async (elsewhere) => {
    const asked = askingAbout(elsewhere, savingAFunction.type, keptFunctionName);
    await asked(savingOperations.createDefinition, savingAFunction.first);
    await asked(savingOperations.updateDefinition, { ...savingAFunction.second, overview: 'Greets each guest' });
    await asked(savingOperations.retireDefinition);
    await asked(savingOperations.restoreDefinition);
  });
  return definitionFactsStored(definitions);
}
