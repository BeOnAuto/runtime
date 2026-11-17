import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { earlierShapeOf, readingEarlierShapes } from '../fact-shapes/earlier-shapes.ts';
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

describe('a fact whose schema may offload a payload', () => {
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

describe('a fact whose schema may offload a payload, however its schema was built', () => {
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

const Digested = Schema.Struct({ sha256: Schema.String });

const keptBy = factOf('kept_by', Digested, ActedContextSchema, { content: { holds: ['/sha256'] } });

const letGoBy = factOf('let_go_by', Digested, ActedContextSchema, { content: { releases: 'all' } });

const noted = factOf('noted', Digested, ActedContextSchema);

describe('the facts that hold content, as their schemas declare them', () => {
  it('are each fact type whose schema declares what it holds or releases, through unions and the readers of its earlier shapes, and no other', () => {
    const earlier = factOf('kept_by', Schema.Struct({ digest: Schema.String }), ActedContextSchema);
    const readingBoth = readingEarlierShapes(keptBy, [
      earlierShapeOf(earlier, ({ data, ...fact }) => ({ ...fact, data: { sha256: data.digest } })),
    ]);

    const holders = contentHoldersOf([Schema.Union([readingBoth, noted]), letGoBy, Schema.String]);

    expect([...holders]).toEqual([
      ['kept_by', { holds: ['/sha256'] }],
      ['let_go_by', { releases: 'all' }],
    ]);
  });

  it('take one declaration of a type that two schemas declare alike, and refuse one that two declare otherwise', () => {
    const keptOtherwise = factOf('kept_by', Digested, ActedContextSchema, { content: { releases: ['/sha256'] } });

    expect([...contentHoldersOf([keptBy, keptBy])]).toEqual([['kept_by', { holds: ['/sha256'] }]]);
    expect(() => contentHoldersOf([keptBy, keptOtherwise])).toThrow(
      'The fact kept_by declares the content it holds and releases in two ways',
    );
  });

  it('refuse a declaration whose pointer does not begin at the root of the fact', () => {
    const malformed = Schema.Struct({ type: Schema.Literal('kept_by'), data: Digested }).annotate({
      heldContent: { holds: ['sha256'] },
    });

    expect(() => contentHoldersOf([malformed])).toThrow('Expected a string matching template literal parts');
  });

  it('pass over a schema with no literal type of its own, whatever it declares', () => {
    const untyped = Schema.Struct({ type: Schema.String, data: Digested }).annotate({
      heldContent: { holds: ['/sha256'] },
    });

    expect([...contentHoldersOf([untyped])]).toEqual([]);
  });
});

describe('the payloads a fact declares it keeps outside', () => {
  it('are read by their digest and size, two members of one object, and a pair that names two objects or one member is refused', () => {
    const kept = factOf('payload_kept', Digested, ActedContextSchema, {
      content: { payloads: [{ sha256: '/kept/*/sha256', bytes: '/kept/*/bytes' }] },
    });
    const pairs = [
      { sha256: '/kept/*/sha256', bytes: '/kept/0/bytes' },
      { sha256: '/kept/*/sha256', bytes: '/sizes/*/bytes' },
      { sha256: '/kept_sha256', bytes: '/kept_sha256' },
    ];

    expect([...contentHoldersOf([kept])]).toEqual([
      ['payload_kept', { payloads: [{ sha256: '/kept/*/sha256', bytes: '/kept/*/bytes' }] }],
    ]);
    for (const pair of pairs) {
      const unmatched = Schema.Struct({ type: Schema.Literal('payload_kept'), data: Digested }).annotate({
        heldContent: { payloads: [pair] },
      });
      expect(() => contentHoldersOf([unmatched])).toThrow(
        'the two pointers of a payload, two members of one object, with * for each element of a list',
      );
    }
  });

  it('are refused among the facts of one schema that release every hold of their stream, or in one fact that does', () => {
    const kept = factOf('payload_kept', Digested, ActedContextSchema, {
      content: { payloads: [{ sha256: '/kept_sha256', bytes: '/kept_bytes' }] },
    });
    const keptAndLetGo = factOf('kept_and_let_go', Digested, ActedContextSchema, {
      content: { releases: 'all', payloads: [{ sha256: '/kept_sha256', bytes: '/kept_bytes' }] },
    });

    expect(() => contentHoldersOf([Schema.Union([kept, letGoBy])])).toThrow(
      'The facts payload_kept keep payloads among facts that release every hold of their stream, let_go_by, which would leave a payload unheld while a fact names it',
    );
    expect(() => contentHoldersOf([keptAndLetGo])).toThrow(
      'The facts kept_and_let_go keep payloads among facts that release every hold of their stream, kept_and_let_go',
    );
    expect([...contentHoldersOf([kept, letGoBy]).keys()]).toEqual(['payload_kept', 'let_go_by']);
  });
});
