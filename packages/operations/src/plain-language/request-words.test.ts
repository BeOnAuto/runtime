import { describe, expect, it } from 'vitest';

import { type ExplainedRejection, explanationOf, rejected, unsuccessfulWords } from '../index.ts';
import { internalTermsIn } from './internal-terms.ts';

describe('unsuccessfulWords of a refusal only the person can answer', () => {
  it("leads with the person's question, so a client that folds the rest still shows it", () => {
    expect(
      unsuccessfulWords(
        'create the playbook “sales”',
        'command',
        rejected('invalid_input', 'Ask the person: What change do you want from this? The goals have one problem.'),
      ),
    ).toBe(
      'Ask the person: What change do you want from this? The goals have one problem. Could not create the playbook “sales”: what was given does not fit what it needs. Nothing was changed. This can be corrected and tried again; the details below say what to change.',
    );
  });

  it('keeps the words of any other refusal as they are, its detail left to the details below', () => {
    expect(
      unsuccessfulWords(
        'create the playbook “sales”',
        'command',
        rejected('invalid_input', 'Ask the person to sign in'),
      ),
    ).toBe(
      'Could not create the playbook “sales”: what was given does not fit what it needs. Nothing was changed. This can be corrected and tried again; the details below say what to change.',
    );
  });
});

const ofPrediction: ReadonlyArray<readonly [ExplainedRejection, string]> = [
  [
    { reason: 'conflict', kind: 'history_too_short' },
    'the history of the series is too short for the forecaster to backtest an answer',
  ],
  [
    { reason: 'unavailable', kind: 'dataset_not_ready' },
    'its dataset is still being built from the playbook’s history',
  ],
  [
    { reason: 'unavailable', kind: 'dataset_not_ready', because: 'stalled' },
    'its dataset stopped at an event its fold could not take',
  ],
];

const aSentence: unknown = expect.stringMatching(/\.$/u);

describe('the explanation of a refusal of a prediction function', () => {
  it.each(ofPrediction)('explains %j and says what to do', (rejection, why) => {
    expect(explanationOf(rejection)).toMatchObject({ why, remedy: aSentence });
  });

  it('says that the history is too short, and to ask again from the period named', () => {
    expect(unsuccessfulWords('predict', 'command', rejected('conflict', 'x', undefined, 'history_too_short'))).toBe(
      'Could not predict: the history of the series is too short for the forecaster to backtest an answer. Nothing was changed. Nothing needs to change: asking again from the period the details below name should work.',
    );
  });
});

const mayHaveReachedSomeone: ReadonlyArray<readonly [ExplainedRejection, string, string]> = [
  [
    { reason: 'unanswered' },
    'nobody answered what it asked',
    'Nothing more of it runs; asking again is a new run, which can be started if an answer is still needed.',
  ],
  [
    { reason: 'unanswered', kind: 'expired' },
    'nobody answered what it asked before the request expired',
    'Nothing more of it runs, though the request may have reached someone; asking again is a new run, which can be started, with more time if needed.',
  ],
  [
    { reason: 'unanswered', kind: 'undelivered' },
    'what it had to send could not be delivered, though every attempt was made',
    'Nothing more of it runs; whoever runs the server can look into the tool it names, and then a new run can send it again.',
  ],
  [
    { reason: 'unanswered', kind: 'declined' },
    'the person it asked to sign in said they did not',
    'Nothing more of it runs; a new run asks them again, once they can sign in.',
  ],
  [
    { reason: 'unanswered', kind: 'signed_out' },
    'the person it acts for is not signed in to the site, and its function stops rather than asks them',
    'A new run can go on once they have signed in to the site.',
  ],
  [
    { reason: 'unanswered', kind: 'no_person' },
    'it acts for no person who can sign in: a key started it, or the person it acts for has left the organization',
    'A run a person of the organization starts acts for them and asks them to sign in.',
  ],
];

const refusedBeforeAsking: ReadonlyArray<readonly [ExplainedRejection, string, string]> = [
  [
    { reason: 'unavailable', kind: 'requests_full' },
    'the playbook already holds as many open requests as it may',
    'Once some of them are answered, expire or are cancelled, it can be tried again.',
  ],
];

describe('the explanation of a request that went unanswered', () => {
  it.each(mayHaveReachedSomeone)('explains %j, which may have reached someone', (rejection, why, remedy) => {
    expect(explanationOf(rejection)).toEqual({ why, remedy, mayHaveChanged: true });
  });

  it('never says that nothing was changed, since the request may have reached someone', () => {
    expect(unsuccessfulWords('ask', 'command', rejected('unanswered', 'x', undefined, 'expired'))).toBe(
      'Could not ask: nobody answered what it asked before the request expired. Nothing more of it runs, though the request may have reached someone; asking again is a new run, which can be started, with more time if needed.',
    );
  });
});

describe('the explanation of a request refused before it asked', () => {
  it.each(refusedBeforeAsking)('explains %j', (rejection, why, remedy) => {
    expect(explanationOf(rejection)).toEqual({ why, remedy });
  });
});

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

describe('unsuccessfulWords of a busy refusal', () => {
  it('give the wait the refusal carries, so each wait reads otherwise, and read in full without one', () => {
    const busy = rejected('unavailable', 'The server is busy', undefined, 'busy');
    const words = [busy, { ...busy, retry_after: 2 }, { ...busy, retry_after: 8 }].map((refusal) =>
      unsuccessfulWords('save the function', 'command', refusal),
    );

    expect(new Set(words).size).toBe(3);
  });
});
