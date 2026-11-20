import { Effect, Schema } from 'effect';

import { defineCapability } from '../../capability/capability.ts';
import type { Trigger } from '../../registry/definition-triggers.ts';
import type { DefinitionsNamed } from '../../used-by/definitions-named.ts';
import { echoDeclaration } from './echo.ts';

const flowDocument = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json)));

const Named = Schema.Array(Schema.Struct({ type: Schema.String, name: Schema.String }));

const Filters = Schema.Array(Schema.Struct({ type: Schema.String, subject: Schema.optionalKey(Schema.String) }));

const namedIn = Schema.decodeUnknownSync(
  Schema.Struct({
    calls: Schema.optionalKey(Named),
    reads: Schema.optionalKey(Named),
    on: Schema.optionalKey(Filters),
    listen: Schema.optionalKey(Filters),
    data: Schema.optionalKey(Filters),
  }),
);

type Filter = (typeof Filters.Type)[number];

function subjectsAt(key: string, filters: readonly Filter[]) {
  return filters.flatMap(({ type, subject }, index) =>
    subject === undefined ? [] : [{ pointer: `/${key}/${index}/subject`, type, subject }],
  );
}

function triggersOf({ on = [] }: ReturnType<typeof namedIn>): readonly Trigger[] {
  const filters = on.map(({ type, ...attributes }, index) => ({ reference: `/on/${index}`, type, attributes }));
  return filters.length === 0 ? [] : [{ kind: 'event', reference: '/on', filters }];
}

function definitionsNamedIn(document: object): DefinitionsNamed {
  const { calls = [], reads = [], on = [], listen = [], data = [] } = namedIn(document);
  return {
    names: [
      ...calls.map(({ type, name }, index) => ({ pointer: `/calls/${index}/name`, type, name })),
      ...reads.map(({ type, name }, index) => ({ pointer: `/reads/${index}/name`, type, name })),
    ],
    subjects: [...subjectsAt('on', on), ...subjectsAt('data', data)],
    awaited: subjectsAt('listen', listen),
  };
}

export const flow = defineCapability({
  type: 'workflow',
  title: 'Flow',
  guide: { name: 'flow' },
  noun: { one: 'workflow', other: 'workflows' },
  describeOutput: echoDeclaration.describeOutput,
  mediaType: 'application/json',
  parse: (source: string) => Effect.sync(() => flowDocument(source)),
  summarize: (details) => ({ details, triggers: triggersOf(namedIn(details)) }),
  definitionsNamed: definitionsNamedIn,
  finishesLater: (document) => document['waits'] === true,
  run: (document) =>
    Effect.succeed(
      document['waits'] === true ? { finishesLater: true, record: {} } : { output: { ran: true }, record: {} },
    ),
});
