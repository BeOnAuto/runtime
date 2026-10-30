import { issueText } from '@on.auto/definitions/document';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { foldOf, recallDocument } from '../testing/campaign-reviews.ts';
import { parseRecallDocument } from './document-parsing.ts';

function withEvents(events: string): string {
  return recallDocument(foldOf('return view + 1;'), `language: typescript\nsource:\n  events: ${events}`);
}

function issuesIn(source: string): readonly string[] {
  return Result.match(parseRecallDocument(source), {
    onSuccess: () => [],
    onFailure: (issues) => issues.map((issue) => issueText(issue)),
  });
}

function filtersOf(source: string): unknown {
  return Result.map(parseRecallDocument(source), ({ details }) => details.filters);
}

describe('the events a recall function folds', () => {
  it('are named by filters of a literal type, and optionally a literal source and subject and data, kept as written', () => {
    const filters = [
      '{type: run_succeeded, subject: reasoning/review-brief}',
      '{type: com.acme.ledger.month-closed, source: /ledger/eu, data: "${ $data.revenue > 100 }"}',
      '{type: com.acme.ping, data: {region: eu}}',
    ];

    expect(filtersOf(withEvents(`[${filters.join(', ')}]`))).toEqual(
      Result.succeed([
        { type: 'run_succeeded', subject: 'reasoning/review-brief' },
        { type: 'com.acme.ledger.month-closed', source: '/ledger/eu', data: '${ $data.revenue > 100 }' },
        { type: 'com.acme.ping', data: { region: 'eu' } },
      ]),
    );
  });

  it('are named by at least one filter and at most eight', () => {
    const nine = Array.from({ length: 9 }, (_, index) => `{type: t${index}}`).join(', ');

    expect(issuesIn(withEvents('[]'))).toEqual([
      'Line 4, /source/events: A recall function folds the events at least one filter names; it names none',
    ]);
    expect(issuesIn(withEvents(`[${nine}]`))).toEqual([
      'Line 4, /source/events: A recall function takes at most 8 filters; it names 9',
    ]);
  });
});

describe('the filters a recall function refuses', () => {
  it('refuses a filter that is not a mapping, or names no literal type, each with its line', () => {
    expect(
      issuesIn(withEvents('\n    - run_succeeded\n    - {source: /ledger}\n    - {type: "${ $data.x }"}')),
    ).toEqual([
      'Line 5, /source/events/0: A filter is a mapping of the attributes an event must have: type, and optionally any other attribute of the event and its data',
      'Line 6, /source/events/1/type: An event filter matched over the event alone names the type of the events it takes',
      'Line 7, /source/events/2/type: type is written out, not computed by an expression, so that it is matched as it is',
    ]);
  });

  it('refuses an attribute it does not test, and a source or subject computed or empty, leaving the expression of its data to the check at save', () => {
    const filters = [
      '    - {type: a, Tenant: x, depth: two}',
      '    - {type: b, subject: "${ $data }", source: ""}',
      '    - {type: c, data: "${ $data.x + }"}',
    ];

    expect(issuesIn(withEvents(`\n${filters.join('\n')}`))).toEqual([
      'Line 5, /source/events/0/Tenant: An event filter names an attribute of the event as CloudEvents names it, in at most 20 lowercase letters and digits, not Tenant',
      'Line 5, /source/events/0/depth: depth is a whole number from 1, written out; a run no reaction started carries no depth and a run no call started no calldepth, so a filter for such runs leaves the attribute out',
      'Line 6, /source/events/1/subject: subject is written out, not computed by an expression, so that it is matched as it is',
      'Line 6, /source/events/1/source: source is text that is not empty',
    ]);
  });
});
