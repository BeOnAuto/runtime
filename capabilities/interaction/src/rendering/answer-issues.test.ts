import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { answerIssues } from './answer-issues.ts';
import { decidedBy, isDecided, placesNeverSet, subschemaAt } from './answer-places.ts';

const schema: Schema.JsonObject = {
  type: 'object',
  required: ['choice', 'decisions'],
  properties: {
    choice: { type: 'string', enum: ['approve', 'reject'] },
    decisions: {
      type: 'object',
      required: ['logo'],
      properties: { logo: { type: 'string', enum: ['approve', 'reject'] } },
      additionalProperties: { type: 'string' },
    },
    tags: { type: 'array', items: { type: 'string' } },
    open: { type: 'object' },
    anything: { oneOf: [{ type: 'string' }, { type: 'number' }] },
  },
};

function cardOf(...buttons: readonly (readonly unknown[])[]): Schema.Json {
  const elements = Object.fromEntries(
    buttons.map((sets, index) => [`b${index}`, { type: 'Button', props: { label: 'Go', sets } }]),
  );
  return { root: 'card', elements: { card: { type: 'Card', children: Object.keys(elements) }, ...elements } };
}

const approve = { at: '/choice', value: 'approve' };

const logo = { at: '/decisions/logo', value: 'approve' };

function detailsOf(card: Schema.Json, against: Schema.JsonObject | undefined = schema): readonly string[] {
  return answerIssues(card, against).map(({ pointer, detail }) => `${pointer}: ${detail}`);
}

describe('the places and values the buttons of a card set, against the answer schema', () => {
  it('has no issue where every place is named and every value fits, and every required part is set', () => {
    expect(detailsOf(cardOf([approve, logo]))).toEqual([]);
  });

  it('is none for a card with no button, or a function with no schema', () => {
    expect(detailsOf({ root: 'card', elements: {} })).toEqual([]);
    expect(answerIssues(cardOf([approve]))).toEqual([]);
    expect(answerIssues('Hello', schema)).toEqual([]);
  });

  it('refuses a place the schema does not name, at the place of its at', () => {
    expect(detailsOf(cardOf([approve, logo, { at: '/choise', value: 'approve' }]))).toEqual([
      '/elements/b0/props/sets/2/at: The answer has no place /choise: set a place the output schema names',
    ]);
  });

  it('refuses a literal value the schema refuses at its place, but not one an expression gives', () => {
    const issues = detailsOf(
      cardOf([{ at: '/choice', value: 'maybe' }, { at: '/decisions/logo', value: { $state: '/input/x' } }, logo]),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('/elements/b0/props/sets/0/value: This does not fit /choice: ');
  });

  it('refuses a card whose buttons never set a part the answer needs, at the first button', () => {
    expect(detailsOf(cardOf([approve]))).toEqual([
      '/elements/b0/props/sets/0: No button sets /decisions, which the answer needs, so the buttons of this card cannot answer it: add a button that sets it',
    ]);
    expect(detailsOf(cardOf([approve, { at: '/decisions/other', value: 'approve' }]))).toEqual([
      '/elements/b0/props/sets/0: No button sets /decisions/logo, which the answer needs, so the buttons of this card cannot answer it: add a button that sets it',
    ]);
  });

  it('passes over a set with no value, or no mapping, as the check of a Button refuses it', () => {
    expect(detailsOf(cardOf([approve, logo, { at: '/choice' }, 'approve']))).toEqual([]);
  });

  it('does not judge what buttons can set where a place is an expression', () => {
    expect(detailsOf(cardOf([{ at: { $template: '/decisions/${id}' }, value: 'approve' }]))).toEqual([]);
  });
});

describe('the subschema at a place of the answer', () => {
  it.each([
    [[], 'schema'],
    [['decisions', 'anything'], 'schema'],
    [['decisions', 'logo'], 'schema'],
    [['tags', '0'], 'schema'],
    [['open', 'anything'], 'open'],
    [['anything', 'deeper'], 'open'],
    [['missing'], 'none'],
    [['choice', 'deeper'], 'open'],
  ])('is found at %j as %s', (segments: readonly string[], kind: string) => {
    expect(subschemaAt(schema, segments).kind).toBe(kind);
  });

  it('is open where the items of a list are any value', () => {
    expect(subschemaAt({ type: 'array', items: true }, ['0']).kind).toBe('open');
    expect(subschemaAt({ items: [{ type: 'string' }] }, ['0']).kind).toBe('open');
  });

  it('is open where the schema allows any other property, and none where it allows none', () => {
    const allowing: Schema.JsonObject = {
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: true,
    };
    const closed: Schema.JsonObject = { type: 'object', properties: { a: {} }, additionalProperties: false };

    expect([subschemaAt(allowing, ['b']).kind, subschemaAt(closed, ['b']).kind]).toEqual(['open', 'none']);
    expect(subschemaAt({ type: 'object', properties: { a: true } }, ['a', 'b']).kind).toBe('open');
  });
});

describe('the parts a schema needs and no place sets', () => {
  it('names each, nested ones by their own path, and none for a schema that needs nothing', () => {
    expect(placesNeverSet(schema, [])).toEqual(['/choice', '/decisions']);
    expect(placesNeverSet(schema, ['/choice', '/decisions/other'])).toEqual(['/decisions/logo']);
    expect(placesNeverSet(schema, ['/choice', '/decisions'])).toEqual([]);
    expect(placesNeverSet({ type: 'object' }, [])).toEqual([]);
  });

  it('escapes a slash in a name', () => {
    expect(placesNeverSet({ required: ['a/b'] }, [])).toEqual(['/a~1b']);
  });
});

describe('a part that is decided', () => {
  it('holds who set it', () => {
    const answered = { decisions: { logo: { by: 'ada', at: 'then' } } };

    expect([
      isDecided(answered, '/decisions/logo'),
      isDecided(answered, '/decisions/other'),
      isDecided(answered, '/decisions'),
      isDecided({}, '/choice'),
    ]).toEqual([true, false, false, false]);
  });
});

describe('who decided a part', () => {
  it('is the person its record names, and none where it names no text', () => {
    const answered = { a: { by: 'ada', at: 'then' }, b: { by: 7 } };

    expect([decidedBy(answered, '/a'), decidedBy(answered, '/b'), decidedBy(answered, '/c')]).toEqual([
      'ada',
      undefined,
      undefined,
    ]);
  });
});
