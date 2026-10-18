import { defineCommand } from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import { plainly } from '../testing/notebook.ts';
import { operationsIn, type DocumentedOperation } from '../testing/openapi/openapi-document.ts';
import { acmeAdmin, operationServer } from '../testing/operation-server.ts';

const TaggingSchema = Schema.Struct({
  tag: Schema.optionalKey(Schema.String),
  untag: Schema.optionalKey(Schema.String),
});

function taggingIssuesOf({ tag, untag }: typeof TaggingSchema.Type): readonly Schema.FilterIssue[] {
  return tag === undefined && untag === undefined ? [{ path: ['tag'], issue: 'Expected tag or untag' }] : [];
}

const tidyNotes = defineCommand('org', {
  name: 'tidy_notes',
  title: 'Tidy notes',
  description: 'Tidies the notes of the org. Use it to clear old notes. It answers whether it tidied.',
  route: { method: 'POST', path: '/notes/tidy' },
  inputSchema: Schema.Struct({ before: Schema.optionalKey(Schema.String) }),
  outputSchema: Schema.Struct({ done: Schema.Boolean }),
  reasons: [],
  handle: () => Effect.succeed({ done: true }),
  plainLanguage: plainly('tidy the notes'),
});

const tagNotes = defineCommand('org', {
  name: 'tag_notes',
  title: 'Tag notes',
  description: 'Tags or untags the notes of the org. Use it to sort the notes. It answers whether it tagged.',
  route: { method: 'POST', path: '/notes/tags' },
  inputSchema: TaggingSchema.check(Schema.makeFilter(taggingIssuesOf)),
  outputSchema: Schema.Struct({ done: Schema.Boolean }),
  reasons: [],
  handle: () => Effect.succeed({ done: true }),
  plainLanguage: plainly('tag the notes'),
});

const RequestBodySchema = Schema.Struct({ required: Schema.Boolean });

function bodyRequiredIn(served: readonly DocumentedOperation[], id: string): boolean {
  const { operation } = Option.getOrThrow(
    Option.fromNullishOr(served.find((described) => described.operation.operationId === id)),
  );
  return Schema.decodeUnknownSync(RequestBodySchema)(operation.requestBody).required;
}

const jsonAsAdmin = { authorization: `Bearer ${acmeAdmin.key}`, 'content-type': 'application/json' };

describe('the body an operation documents', () => {
  it('is required where the input refuses {}, by a check of the whole input too, and one left optional takes {}', async () => {
    const { handler } = await operationServer({ operations: [tidyNotes, tagNotes] });
    const served = operationsIn((await call(handler, '/v1/openapi.json')).body);
    const sent = ['/v1/orgs/acme/notes/tidy', '/v1/orgs/acme/notes/tags'].map(
      async (path) => (await call(handler, path, { method: 'POST', headers: jsonAsAdmin, body: '{}' })).status,
    );

    expect([bodyRequiredIn(served, 'tidy_notes'), bodyRequiredIn(served, 'tag_notes')]).toEqual([false, true]);
    expect(await Promise.all(sent)).toEqual([200, 422]);
  });
});
