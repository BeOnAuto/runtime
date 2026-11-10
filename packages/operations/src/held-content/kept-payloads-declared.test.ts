import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ActedContextSchema } from '../ledger/context.ts';
import { factOf } from '../ledger/decider.ts';
import { payloadFields, payloadPointersOf, withPayloads } from '../payloads/payload-fields.ts';
import { contentHoldersOf } from './content-declaration.ts';

const NotedSchema = withPayloads(
  Schema.Struct({ ...payloadFields('text', Schema.String), ...payloadFields('summary', Schema.String) }),
  ['text'],
  ['summary'],
);

const ContentSchema = Schema.Struct({ content: NotedSchema, by: Schema.String });

describe('a fact whose schema may keep a payload outside it', () => {
  it('is held where it declares each payload its schema may keep, at the top or within a member', () => {
    const declared = contentHoldersOf([
      factOf('noted', NotedSchema, ActedContextSchema, {
        content: { payloads: [payloadPointersOf('text'), payloadPointersOf('summary')] },
      }),
      factOf('filed', ContentSchema, ActedContextSchema, {
        content: { payloads: [payloadPointersOf('text', '/content'), payloadPointersOf('summary', '/content')] },
      }),
    ]);

    expect([...declared.keys()]).toEqual(['noted', 'filed']);
  });

  it('is refused where it leaves a payload undeclared, or declares none, since nothing would hold the content', () => {
    expect(() =>
      contentHoldersOf([
        factOf('noted', NotedSchema, ActedContextSchema, { content: { payloads: [payloadPointersOf('text')] } }),
      ]),
    ).toThrow(
      'The fact noted may keep /summary_sha256 outside it but declares no payload there, so nothing would hold its content',
    );
    expect(() => contentHoldersOf([factOf('filed', ContentSchema, ActedContextSchema)])).toThrow(
      'The fact filed may keep /content/text_sha256, /content/summary_sha256 outside it',
    );
  });

  it('is refused where a value that may be absent keeps one undeclared, and a fact with no data keeps none', () => {
    const MaybeSchema = Schema.Struct({ note: Schema.NullOr(NotedSchema) });

    expect(() => contentHoldersOf([factOf('maybe', MaybeSchema, ActedContextSchema)])).toThrow(
      'The fact maybe may keep /note/text_sha256, /note/summary_sha256 outside it',
    );
    expect(contentHoldersOf([Schema.Struct({ type: Schema.Literal('bare') })]).size).toBe(0);
  });

  it('is refused where a list of such values is not declared for each element', () => {
    const ListedSchema = Schema.Struct({ notes: Schema.Array(NotedSchema) });

    expect(() =>
      contentHoldersOf([
        factOf('listed', ListedSchema, ActedContextSchema, {
          content: { payloads: [payloadPointersOf('text', '/notes/*')] },
        }),
      ]),
    ).toThrow('The fact listed may keep /notes/*/summary_sha256 outside it');
  });
});

describe('a fact whose schema may keep a payload outside it, however its schema was built', () => {
  it('is refused undeclared where its schema was given a check after its payloads, or has payload fields alone', () => {
    const CheckedAfterSchema = NotedSchema.check(Schema.makeFilter(() => true));
    const FieldsAloneSchema = Schema.Struct({ ...payloadFields('text', Schema.String) });

    expect(() => contentHoldersOf([factOf('checked', CheckedAfterSchema, ActedContextSchema)])).toThrow(
      'The fact checked may keep /text_sha256, /summary_sha256 outside it',
    );
    expect(() => contentHoldersOf([factOf('bare', FieldsAloneSchema, ActedContextSchema)])).toThrow(
      'The fact bare may keep /text_sha256 outside it',
    );
  });
});
