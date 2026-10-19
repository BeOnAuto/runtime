import { describe, expect, it } from 'vitest';

import { fieldMeaning, mostMeaningCharacters, valueMeaning } from './field-meanings.ts';

describe('the meaning of a field', () => {
  it('is the first clause of its description, its first word lowered, where it opens with an article or a question word', () => {
    expect([
      fieldMeaning('label', 'The month, such as April 2026', 'among-others'),
      fieldMeaning('draft', 'The draft report', 'among-others'),
      fieldMeaning('owner', 'Its owner. Text of a user id', 'among-others'),
      fieldMeaning('urgent', 'Whether to post it at once; a flag', 'among-others'),
      fieldMeaning('wait', 'How long to wait: a duration', 'among-others'),
      fieldMeaning('rows', 'Each row of the sheet.', 'among-others'),
      fieldMeaning('who', 'WHO answers it', 'among-others'),
    ]).toEqual([
      'the month',
      'the draft report',
      'its owner',
      'whether to post it at once',
      'how long to wait',
      'each row of the sheet',
      'who answers it',
    ]);
  });

  it('keeps the commas of the description of a field told alone, and reads its lines as one', () => {
    expect([
      fieldMeaning('month', 'The month to report on, as 2026-04 or April 2026', 'alone'),
      fieldMeaning('month', 'The month to report on, as 2026-04 or April 2026', 'among-others'),
      fieldMeaning('month', 'The month\n  to report on', 'alone'),
    ]).toEqual([
      'the month to report on, as 2026-04 or April 2026',
      'the month to report on',
      'the month to report on',
    ]);
  });
});

describe('the meaning of a field whose description says no noun phrase', () => {
  it(`is the name of the field in words, with the, where its clause opens otherwise or passes ${mostMeaningCharacters} characters`, () => {
    const long = `The ${'very '.repeat(12)}long month`;

    expect([
      fieldMeaning('approver', 'Chat user id of the approver', 'among-others'),
      fieldMeaning('prev_label', undefined, 'among-others'),
      fieldMeaning('draftReport', 'The', 'alone'),
      fieldMeaning('month', long, 'alone'),
      fieldMeaning('month', `The ${'é'.repeat(mostMeaningCharacters - 4)}`, 'alone'),
      fieldMeaning('theory', 'Theory of the case', 'alone'),
      fieldMeaning('_', ': nothing first', 'alone'),
    ]).toEqual([
      'the approver',
      'the prev label',
      'the draft report',
      'the month',
      `the ${'é'.repeat(mostMeaningCharacters - 4)}`,
      'the theory',
      'the _',
    ]);
  });
});

const inputSchema = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'The month, such as April 2026' },
    figures: { type: 'object' },
    items: { type: 'array', items: { type: 'object', description: 'One line of the order' } },
  },
};

describe('the meaning of a value a template reads', () => {
  it('is the meaning of the field of the input it names, read among the fields that hold it', () => {
    expect([
      valueMeaning(['input', 'label'], inputSchema),
      valueMeaning(['input', 'items', 0], inputSchema, new Set()),
      valueMeaning(['input', 'figures', 'site'], inputSchema, new Set()),
      valueMeaning(['input', 'items', null], inputSchema, new Set()),
      valueMeaning(['input', 'label'], undefined, new Set()),
    ]).toEqual(['the month', 'one line of the order', 'the site', 'the items', 'the label']);
  });

  it('is the input as its schema describes it, or the input, for the input itself', () => {
    expect([
      valueMeaning(['input'], { type: 'object', description: 'The order to confirm' }, new Set()),
      valueMeaning(['input'], { type: 'object' }, new Set()),
      valueMeaning(['input'], undefined, new Set()),
    ]).toEqual(['the order to confirm', 'the input', 'the input']);
  });

  it("is today's date, the time now, a loop's variable by its last name, and any other value by its last name with the", () => {
    expect([
      valueMeaning(['today'], inputSchema, new Set()),
      valueMeaning(['now'], inputSchema, new Set()),
      valueMeaning(['line', 'sku_code'], inputSchema, new Set(['line'])),
      valueMeaning(['line'], inputSchema, new Set(['line'])),
      valueMeaning(['forloop', 'index'], inputSchema, new Set(['line'])),
      valueMeaning(['total'], inputSchema, new Set()),
      valueMeaning([null], inputSchema),
    ]).toEqual(["today's date", 'the time now', 'sku code', 'line', 'the index', 'the total', 'the value']);
  });
});
