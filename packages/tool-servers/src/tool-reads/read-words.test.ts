import { unsuccessfulWords } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineDryRun, defineIntrospect } from '../index.ts';

const lookup = { lookUp: () => Effect.never };

const introspectWords = defineIntrospect(lookup).registration.plainLanguage;

const dryRunWords = defineDryRun(lookup).registration.plainLanguage;

const asked = { server: 'graph', tool: 'search' };

const takingTwo = {
  type: 'object',
  properties: { query: { type: 'string' }, maxRows: { type: 'integer' } },
};

describe('the plain words of introspect', () => {
  it('say which tool it tried to describe, what it takes and what its mark means', () => {
    expect(introspectWords?.attempt(asked)).toBe('describe the search tool of graph');
    const described = { ...asked, description: '', input_schema: { type: 'object' }, marked_by: 'server' } as const;

    expect(
      introspectWords?.outcome(
        { ...described, input_schema: takingTwo, annotations: { readOnlyHint: true }, mark: 'reads' },
        asked,
      ),
    ).toBe(
      'The search tool of graph takes 2 arguments, query and max rows, and is marked reads, so it only reads; what it does and what it takes are in the details.',
    );
    expect([
      introspectWords?.outcome({ ...described, mark: 'acts' }, asked),
      introspectWords?.outcome({ ...described, mark: 'unmarked' }, asked),
    ]).toEqual([
      'The search tool of graph takes no arguments and is marked acts, so it may change something; what it does and what it takes are in the details.',
      'The search tool of graph takes no arguments and is unmarked, so it counts as one that may change something; what it does and what it takes are in the details.',
    ]);
  });

  it('end a refusal with what search shows, in place of the words for a function', () => {
    const refusal = { status: 'rejected', reason: 'unavailable', detail: 'x', kind: 'tool_not_offered' } as const;

    expect(
      unsuccessfulWords(
        'describe the search tool of wiki',
        'query',
        { ...refusal, because: 'tool_server_not_configured' },
        introspectWords?.remedies,
      ),
    ).toBe(
      'Could not describe the search tool of wiki: this server does not offer a tool it names, because whoever runs the server has not set up a tool server of that name for this playbook. This can be put right on your side: search shows the tool servers this playbook may use, so naming one of those can work.',
    );
    expect(
      [
        unsuccessfulWords('x', 'query', { ...refusal, because: 'tool_not_allowed' }, introspectWords?.remedies),
        unsuccessfulWords('x', 'query', { ...refusal, because: 'tool_not_listed' }, introspectWords?.remedies),
      ].map((words) => words.slice(words.indexOf(' This can be put right'))),
    ).toEqual([
      ' This can be put right on your side: search shows the tools this playbook may use, which whoever runs the server allows, so naming one of those can work.',
      ' This can be put right on your side: search shows the tools each tool server has, so naming one of those can work.',
    ]);
  });
});

const wouldRun = {
  would_run: true,
  needs: 'playbook:write',
  caller_may: true,
  playbook_retired: false,
  allowed: true,
  mark: 'reads',
  arguments: null,
  server: { reachable: 'yes' },
};

describe('the plain words of dry_run', () => {
  it('say that a call would be made, what the mark of the tool means, and whether its arguments are what it takes', () => {
    expect(dryRunWords?.attempt(asked)).toBe('dry run the search tool of graph');
    expect([
      dryRunWords?.outcome(wouldRun, asked),
      dryRunWords?.outcome({ ...wouldRun, mark: 'acts', arguments: { valid: true, issues: [] } }, asked),
      dryRunWords?.outcome({ ...wouldRun, mark: 'unmarked', arguments: { valid: false, issues: [] } }, asked),
      dryRunWords?.outcome({ ...wouldRun, mark: null, arguments: { valid: null, issues: [] } }, asked),
    ]).toEqual([
      'A call of the search tool of graph would be made now, and the tool is marked reads, so it only reads.',
      'A call of the search tool of graph would be made now, and the tool is marked acts, so it may change something, and its arguments are what it takes.',
      'A call of the search tool of graph would be made now, and the tool is unmarked, so it counts as one that may change something, but its arguments are not what it takes.',
      'A call of the search tool of graph would be made now, and the tool may change something, though its arguments could not be checked on this server.',
    ]);
  });

  it('say every reason a call would not be made', () => {
    const refused = { ...wouldRun, would_run: false, mark: null };

    expect([
      dryRunWords?.outcome({ ...refused, caller_may: false }, asked),
      dryRunWords?.outcome({ ...refused, playbook_retired: true }, asked),
      dryRunWords?.outcome({ ...refused, allowed: false, server: { reachable: 'no', because: 'key_refused' } }, asked),
      dryRunWords?.outcome({ ...refused, server: { reachable: 'no', because: 'scope_lacking' } }, asked),
      dryRunWords?.outcome({ ...refused, server: { reachable: 'no', because: 'unreachable' } }, asked),
    ]).toEqual([
      'A call of the search tool of graph would not be made now: the caller may not change this playbook, which a call needs.',
      'A call of the search tool of graph would not be made now: the playbook is retired and can no longer change.',
      'A call of the search tool of graph would not be made now: whoever runs this server does not allow the tool; its tool server did not accept the key this server gives it.',
      'A call of the search tool of graph would not be made now: its tool server asks for a scope its credential lacks.',
      'A call of the search tool of graph would not be made now: its tool server could not be asked just now.',
    ]);
  });
});
