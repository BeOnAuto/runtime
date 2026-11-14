import { InvalidInput } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { testPlaybookNames } from '../testing/test-sandbox.ts';
import { contributionExpressionsOf } from './workflow-contributions.ts';
import { workflowReaderOf } from './workflow-document.ts';
import { summaryOf } from './workflow-summary.ts';

const header = `document:
  dsl: '1.0.3'
  namespace: acme
  name: measuring
  version: '1.0.0'
`;

const steps = 'do:\n  - count: { set: { customers: 3, status: measured } }\n';

const measuring = `contributes:
  - goal: paying-customers
    purpose: Measures what each experiment brought in.
    each: /results
    per_id: /issue_id
    title: /title
    link: /issue_url
    when: \${ $data.status == "measured" }
    marks: measured
    measures: /customers_attributed
    final: /window_closed
    as_of: /measured_through
    says: /summary
  - goal: steady-orders
    purpose: Says the orders held.
    final: true
`;

const read = (goals: boolean, source: string) => Effect.runPromise(workflowReaderOf(testPlaybookNames, goals)(source));

const refusal = (goals: boolean, source: string) =>
  Effect.runPromise(Effect.flip(workflowReaderOf(testPlaybookNames, goals)(source)));

function refused(issues: readonly string[]): InvalidInput {
  return new InvalidInput({
    detail: 'The workflow document is not a workflow this runtime runs',
    issues: issues.map((detail) => ({ detail, pointer: '' })),
  });
}

const contributesUnknown = 'Line 1, column 1: It has contributes, which the DSL does not know here';

describe('the contributes list of a workflow document, where goals are kept', () => {
  it('is set aside from the document the engine runs and read typed beside it', async () => {
    const reading = await read(true, `${header}${measuring}${steps}`);

    expect(reading).toMatchObject({
      contributes: [
        {
          goal: 'paying-customers',
          purpose: 'Measures what each experiment brought in.',
          each: '/results',
          when: '${ $data.status == "measured" }',
          final: '/window_closed',
        },
        { goal: 'steady-orders', purpose: 'Says the orders held.', final: true },
      ],
    });
    expect(Object.keys(reading.document)).toEqual(['document', 'do']);
  });

  it('is kept in the details of the summary, beside the calls', async () => {
    const reading = await read(true, `${header}${measuring}${steps}`);

    expect(summaryOf(reading.document, reading.contributes).details).toEqual({ contributes: reading.contributes });
    expect(summaryOf(reading.document).details).toBeUndefined();
  });
});

describe('a contributes list that does not fit, where goals are kept', () => {
  it('is refused when it is no list, or holds more than eight entries', async () => {
    const nine = Array.from({ length: 9 }, () => '  - { goal: g, purpose: p }\n').join('');

    expect(await refusal(true, `${header}contributes: paying-customers\n${steps}`)).toMatchObject(
      refused(['Line 6, column 14: at /contributes: It must be a list of at most 8 contributions']),
    );
    expect(await refusal(true, `${header}contributes:\n${nine}${steps}`)).toMatchObject(
      refused(['Line 7, column 3: at /contributes: It has 9 contributions, and a workflow has at most 8']),
    );
  });

  it('is refused for each entry that does not fit, at its line', async () => {
    const source = `${header}contributes:
  - paying-customers
  - { by_hand: true }
  - goal: ' '
    purpose: 4
    each: results
    when: $data.status == "measured"
    marks: ''
    final: false
${steps}`;

    expect(await refusal(true, source)).toMatchObject(
      refused([
        'Line 7, column 5: at /contributes/0: It must be a mapping that names a goal and its purpose',
        'Line 8, column 5: at /contributes/1: It needs goal',
        'Line 8, column 5: at /contributes/1: It needs purpose',
        'Line 8, column 5: at /contributes/1: It has by_hand, which a contribution does not know',
        'Line 9, column 11: at /contributes/2/goal: It must be words, not left blank',
        'Line 10, column 14: at /contributes/2/purpose: It must be words, not left blank',
        'Line 11, column 11: at /contributes/2/each: It must be a pointer into the output that starts with a slash, such as /total',
        'Line 12, column 11: at /contributes/2/when: It must be one expression over $data, written in ${ }',
        'Line 13, column 12: at /contributes/2/marks: It must be words, not left blank',
        'Line 14, column 12: at /contributes/2/final: It must be true, or a pointer to a boolean in the output, such as /window_closed',
      ]),
    );
  });
});

describe('a contributes list beside the rest of the document, where goals are kept', () => {
  it('is refused beside the problems of the rest of the document', async () => {
    expect(
      await refusal(true, `${header}contributes: none\ndo:\n  - loop:\n      for: { each: item }\n      do: []\n`),
    ).toMatchObject(
      refused([
        'Line 6, column 14: at /contributes: It must be a list of at most 8 contributions',
        'Line 9, column 12: at /do/0/loop/for: It needs in',
      ]),
    );
  });

  it('places each condition for the type check, over $data alone', async () => {
    const reading = await read(true, `${header}${measuring}${steps}`);

    expect(contributionExpressionsOf(reading.contributes)).toEqual([
      { pointer: '/contributes/0/when', source: ' $data.status == "measured" ', names: ['$data'] },
    ]);
    expect(contributionExpressionsOf()).toEqual([]);
  });
});

describe('the contributes list of a workflow document, where goals are not kept', () => {
  it('is still read and set aside, so a workflow saved with it keeps running', async () => {
    const kept = await read(true, `${header}${measuring}${steps}`);
    const notKept = await read(false, `${header}${measuring}${steps}`);

    expect(notKept.contributes).toEqual(kept.contributes);
    expect(notKept.document).toEqual(kept.document);
  });

  it('is refused as a key the document does not know when it does not fit', async () => {
    expect(await refusal(false, `${header}contributes: paying-customers\n${steps}`)).toMatchObject(
      refused([contributesUnknown]),
    );
  });

  it('is named as a key the document does not know beside the problems of the rest of it', async () => {
    expect(
      await refusal(false, `${header}${measuring}do:\n  - loop:\n      for: { each: item }\n      do: []\n`),
    ).toMatchObject(refused([contributesUnknown, 'Line 24, column 12: at /do/0/loop/for: It needs in']));
  });

  it('is named beside the problems of an input schema that does not compile', async () => {
    const source = `${header}contributes: []\ninput:\n  schema:\n    document: { type: wrong }\n${steps}`;
    const { issues } = await refusal(false, source);

    expect(issues.map(({ detail }) => detail)).toContain(contributesUnknown);
  });
});
