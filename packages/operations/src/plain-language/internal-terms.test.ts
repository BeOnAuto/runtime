import { describe, expect, it } from 'vitest';

import { internalTermsIn } from './internal-terms.ts';

const leaks: ReadonlyArray<readonly [string, string]> = [
  ['Created the inference spec.', 'spec'],
  ['The specs of the playbook.', 'specs'],
  ['A primitive of the playbook.', 'primitive'],
  ['The execution started.', 'execution'],
  ['It ran an inference.', 'inference'],
  ['An orchestration started.', 'orchestration'],
  ['It folds a recollection.', 'recollection'],
  ['Its YAML is wrong.', 'YAML'],
  ['Its yml is wrong.', 'yml'],
  ['It answered in JSON.', 'JSON'],
  ['Its Liquid template.', 'Liquid'],
  ['Its jq program.', 'jq'],
  ['The input schema.', 'schema'],
  ['Its front matter.', 'front matter'],
  ['The enum of names.', 'enum'],
  ['It is idempotent.', 'idempotent'],
  ['It answered 503.', '503'],
  ['Set ANTHROPIC_API_KEY first.', 'ANTHROPIC_API_KEY'],
  ['Run 0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a failed.', '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a'],
  ['It calls anthropic/claude-sonnet-4-5.', 'c/c'],
];

describe('internalTermsIn', () => {
  it.each(leaks)('finds an internal term in %j', (text, term) => {
    expect(internalTermsIn(text)).toContain(term);
  });

  it('finds none in words for a person', () => {
    expect(
      internalTermsIn(
        'Created the reasoning function “summary”. What it does: Summarizes a text. It has been saved but has not been run yet.',
      ),
    ).toEqual([]);
  });

  it('leaves alone words that only contain a term', () => {
    expect(internalTermsIn('A specific, inspected prospect with 12 notes, ran by 2030.')).toEqual([]);
  });

  it('leaves alone a measured number that only looks like a status code', () => {
    expect(
      internalTermsIn('It answered in 126 ms, read 1,250 rows and 300 events over 3.125 s, and holds 512 MiB.'),
    ).toEqual([]);
  });

  it('still finds a status code beside a measured number', () => {
    expect(internalTermsIn('It answered 404 after 126 ms.')).toEqual(['404']);
  });

  it('leaves alone a number and a range in a unit the text measures in, and still finds a status code there', () => {
    const measured = 'It predicts 131 orders in 2026-W45 (100 to 160 orders) and 120 sign-ups.';

    expect([
      internalTermsIn(measured, ['orders', 'sign-ups']),
      internalTermsIn(measured),
      internalTermsIn('It answered 404 for 131 orders.', ['orders']),
      internalTermsIn('It answered 404 and 3 rows.'),
    ]).toEqual([[], ['131'], ['404'], ['404']]);
  });
});
