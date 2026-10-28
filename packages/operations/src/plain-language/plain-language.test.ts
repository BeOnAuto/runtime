import { Effect, Schema, SchemaTransformation } from 'effect';
import { describe, expect, it } from 'vitest';

import { Conflict, defineCommand, quoted, Unavailable, type ConflictKind } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toOrg } from '../testing/harness.ts';

const Title = Schema.String.pipe(Schema.decodeTo(Schema.Trimmed, SchemaTransformation.trim()));

const Shelf = Schema.Struct({ title: Title, books: Schema.Int });

function shelving(kind?: ConflictKind) {
  return defineCommand('org', {
    name: 'make_shelf',
    title: 'Make shelf',
    description: 'Makes a shelf.',
    route: { method: 'POST', path: '/shelves' },
    inputSchema: Schema.Struct({ title: Title }),
    outputSchema: Shelf,
    reasons: ['conflict', 'unavailable'],
    handle: ({ title }) => {
      if (title === 'elsewhere') {
        return Effect.fail(new Unavailable({ detail: 'Shelves are made elsewhere', kind: 'model_not_offered' }));
      }
      if (title === 'forbidden') {
        return Effect.fail(
          new Unavailable({
            detail: 'That shelf is not allowed',
            kind: 'model_not_offered',
            because: 'model_not_allowed',
          }),
        );
      }
      if (title === 'unlicensed') {
        return Effect.fail(
          new Conflict({
            detail: 'This shelf needs a key',
            kind: 'license_required',
            resolve_at: 'https://studio.example.com/licenses?installation=shelf-1',
            runtime_id: 'shelf-1',
          }),
        );
      }
      return title === 'taken'
        ? Effect.fail(new Conflict({ detail: 'There is a shelf taken', ...(kind === undefined ? {} : { kind }) }))
        : Effect.succeed({ title, books: 0 });
    },
    plainLanguage: {
      task: 'make a shelf',
      attempt: ({ title }) => `make the shelf ${quoted(title)}`,
      outcome: ({ title, books }, input) => `Made the shelf ${quoted(title)} for ${input.title}, with ${books} books.`,
      remedies: { model_not_allowed: 'A shelf of another title can be made.' },
    },
  });
}

const { registration } = shelving();

const offeredInputs: ReadonlyArray<readonly [string, unknown]> = [
  ['input it cannot decode', { title: 7 }],
  ['no input at all', undefined],
];

describe('the plain language of a registration', () => {
  it('names what was attempted from the input as the operation decodes it', () => {
    expect(registration.plainLanguage?.attempt({ title: '  Poetry  ' })).toBe('make the shelf “Poetry”');
  });

  it('names what was attempted from input that also has fields the operation does not know', () => {
    expect(registration.plainLanguage?.attempt({ title: 'Poetry', playbook: 'alpha' })).toBe('make the shelf “Poetry”');
  });

  it.each(offeredInputs)('falls back to the task for %s', (_case, input) => {
    expect(registration.plainLanguage?.attempt(input)).toBe('make a shelf');
  });

  it('describes the outcome from the encoded output and the input', () => {
    expect(registration.plainLanguage?.outcome({ title: 'Poetry', books: 0 }, { title: ' Poetry ' })).toBe(
      'Made the shelf “Poetry” for Poetry, with 0 books.',
    );
  });

  it('is absent from an operation that does not declare it', () => {
    const bare = defineCommand('org', {
      name: 'bare_shelf',
      title: 'Bare shelf',
      description: 'Makes nothing.',
      route: { method: 'POST', path: '/bare' },
      inputSchema: Schema.Struct({ size: Schema.Int }),
      outputSchema: Schema.Struct({ made: Schema.Boolean }),
      reasons: [],
      handle: () => Effect.succeed({ made: false }),
    });

    expect(bare.registration.plainLanguage).toBeUndefined();
  });
});

describe('the remedies of a registration', () => {
  it('carries the remedies the operation gives of its own, and none when it gives none', () => {
    const plain = defineCommand('org', {
      name: 'plain_shelf',
      title: 'Plain shelf',
      description: 'Makes nothing.',
      route: { method: 'POST', path: '/plain' },
      inputSchema: Schema.Struct({ size: Schema.Int }),
      outputSchema: Schema.Struct({ made: Schema.Boolean }),
      reasons: [],
      handle: () => Effect.succeed({ made: false }),
      plainLanguage: { task: 'make nothing', attempt: () => 'make nothing', outcome: () => 'Made nothing.' },
    });

    expect(registration.plainLanguage?.remedies).toEqual({
      model_not_allowed: 'A shelf of another title can be made.',
    });
    expect(plain.registration.plainLanguage?.remedies).toEqual({});
  });
});

const toAcme = toOrg('acme');

describe('the resolution of a conflict', () => {
  it('reaches the rejected outcome with where a person resolves it and the runtime it names', async () => {
    const { dispatcher, run } = harness();

    const outcome = await run(dispatcher.dispatchToOrg(registration, toAcme(acmeAdmin, { title: 'unlicensed' })));

    expect(outcome).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'This shelf needs a key',
      kind: 'license_required',
      resolve_at: 'https://studio.example.com/licenses?installation=shelf-1',
      runtime_id: 'shelf-1',
    });
  });
});

describe('the kind of a conflict', () => {
  it.each<ConflictKind>(['taken', 'retired', 'concurrent_change', 'unworkable'])(
    'reaches the rejected outcome as %s',
    async (kind) => {
      const { dispatcher, run } = harness();

      const outcome = await run(
        dispatcher.dispatchToOrg(shelving(kind).registration, toAcme(acmeAdmin, { title: 'taken' })),
      );

      expect(outcome).toEqual({
        status: 'rejected',
        reason: 'conflict',
        detail: 'There is a shelf taken',
        kind,
      });
    },
  );

  it('reaches the rejected outcome for unavailability too', async () => {
    const { dispatcher, run } = harness();

    const outcome = await run(dispatcher.dispatchToOrg(registration, toAcme(acmeAdmin, { title: 'elsewhere' })));

    expect(outcome).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'Shelves are made elsewhere',
      kind: 'model_not_offered',
    });
  });

  it('is left out when the conflict does not say', async () => {
    const { dispatcher, run } = harness();

    const outcome = await run(dispatcher.dispatchToOrg(registration, toAcme(acmeAdmin, { title: 'taken' })));

    expect(outcome).toEqual({ status: 'rejected', reason: 'conflict', detail: 'There is a shelf taken' });
  });
});

describe('the rejection of something not offered', () => {
  it('carries why something is not offered, when the rejection says', async () => {
    const { dispatcher, run } = harness();

    const outcome = await run(dispatcher.dispatchToOrg(registration, toAcme(acmeAdmin, { title: 'forbidden' })));

    expect(outcome).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'That shelf is not allowed',
      kind: 'model_not_offered',
      because: 'model_not_allowed',
    });
  });
});
