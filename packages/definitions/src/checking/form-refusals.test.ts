import { describe, expect, it } from 'vitest';

import { fieldWords, wordsOf } from '../testing/refusal-words.ts';

describe('the words of a string out of its form', () => {
  it('says the form a field takes and an example of it, as the bounds are said', () => {
    expect([
      fieldWords({ type: 'string', format: 'date' }, 'April'),
      fieldWords({ type: 'string', format: 'date-time' }, 'April 1st, 9:30'),
      fieldWords({ type: 'string', format: 'time' }, 'half past nine'),
      fieldWords({ type: 'string', format: 'email' }, 'ada'),
      fieldWords({ type: 'string', format: 'uri' }, 'example.com'),
      fieldWords({ type: 'string', format: 'uuid' }, '42'),
    ]).toEqual([
      'field: expected a date such as 2026-04-01.',
      'field: expected a date and time such as 2026-04-01T09:30:00Z.',
      'field: expected a time such as 09:30:00Z.',
      'field: expected an email address such as name@example.com.',
      'field: expected a URI such as https://example.com.',
      'field: expected a UUID such as 0f8fad5b-d9cb-469f-a165-70867728950e.',
    ]);
  });

  it('keeps the description and the examples of the field before the form, and says a name out of its form', () => {
    expect([
      fieldWords({ type: 'string', format: 'date', description: 'The day the order is due' }, 'Friday'),
      fieldWords({ type: 'string', minLength: 12, format: 'date' }, 'Friday'),
      fieldWords({ type: 'object', propertyNames: { format: 'date' } }, { soon: 1 }),
    ]).toEqual([
      'field, The day the order is due: expected a date such as 2026-04-01.',
      'field: expected at least 12 characters. field: expected a date such as 2026-04-01.',
      'the name soon of field: expected a date such as 2026-04-01.',
    ]);
  });

  it('leaves the example of the form out where the field gives its own, in its examples or its description', () => {
    expect([
      fieldWords({ type: 'string', format: 'date', examples: ['2026-05-01'] }, 'Friday'),
      fieldWords({ type: 'string', format: 'date', description: 'The day, such as 2026-05-01' }, 'Friday'),
      fieldWords(
        { type: 'object', description: 'Totals by day, such as 2026-05-01', propertyNames: { format: 'date' } },
        { soon: 1 },
      ),
      wordsOf({ type: 'string', format: 'date', examples: ['2026-05-01'] }, 'Friday'),
    ]).toEqual([
      'field, such as “2026-05-01”: expected a date.',
      'field, The day, such as 2026-05-01: expected a date.',
      'the name soon of field, Totals by day, such as 2026-05-01: expected a date.',
      'The input: expected a date such as 2026-04-01.',
    ]);
  });
});
