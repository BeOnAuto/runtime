import { unsuccessfulWords } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineDryRun, defineExecuteConnection, defineIntrospect } from '../index.ts';

const lookup = { lookUp: () => Effect.never };

const introspectWords = defineIntrospect(lookup).registration.plainLanguage;

const executing = defineExecuteConnection({ open: () => Effect.never, configured: false }).registration;

const dryRunWords = defineDryRun(lookup, executing).registration.plainLanguage;

const asked = { server: 'graph', tool: 'search' };

const introspectTerms = { remedies: introspectWords?.remedies };

const takingTwo = {
  type: 'object',
  properties: { query: { type: 'string' }, maxRows: { type: 'integer' } },
};

function distinct(texts: readonly (string | undefined)[]): number {
  return new Set(texts).size;
}

describe('the plain words of introspect', () => {
  it('name the tool it tried to describe, what it takes, and say a different thing for each mark', () => {
    const described = { ...asked, description: '', input_schema: { type: 'object' }, marked_by: 'server' } as const;
    const outcomes = [
      introspectWords?.outcome(
        { ...described, input_schema: takingTwo, annotations: { readOnlyHint: true }, mark: 'reads' },
        asked,
      ),
      introspectWords?.outcome({ ...described, mark: 'acts' }, asked),
      introspectWords?.outcome({ ...described, mark: 'unmarked' }, asked),
    ];

    expect(introspectWords?.attempt(asked)).toContain('search');
    expect(outcomes[0]).toContain('max rows');
    expect(outcomes.every((words) => words?.includes('graph') === true)).toBe(true);
    expect(distinct(outcomes)).toBe(3);
  });

  it('end a refusal with a remedy of its own for each reason, in place of the words for a function', () => {
    const refusal = { status: 'rejected', reason: 'unavailable', detail: 'x', kind: 'tool_not_offered' } as const;
    const becauses = ['tool_server_not_configured', 'tool_not_allowed', 'tool_not_listed'] as const;
    const remedied = becauses.map((because) =>
      unsuccessfulWords('describe the search tool of wiki', 'query', { ...refusal, because }, introspectTerms),
    );
    const plain = becauses.map((because) =>
      unsuccessfulWords('describe the search tool of wiki', 'query', { ...refusal, because }, {}),
    );

    expect(distinct(remedied)).toBe(3);
    expect(remedied.filter((words, index) => words === plain[index])).toEqual([]);
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
  it('say a different thing for each mark and each check of the arguments', () => {
    const outcomes = [
      dryRunWords?.outcome(wouldRun, asked),
      dryRunWords?.outcome({ ...wouldRun, mark: 'acts', arguments: { valid: true, issues: [] } }, asked),
      dryRunWords?.outcome({ ...wouldRun, mark: 'unmarked', arguments: { valid: false, issues: [] } }, asked),
      dryRunWords?.outcome({ ...wouldRun, mark: null, arguments: { valid: null, issues: [] } }, asked),
    ];

    expect(dryRunWords?.attempt(asked)).toContain('search');
    expect(outcomes.every((words) => words?.includes('graph') === true)).toBe(true);
    expect(distinct(outcomes)).toBe(4);
  });

  it('say a different thing for every reason a call would not be made, every reason when there are two', () => {
    const refused = { ...wouldRun, would_run: false, mark: null };
    const keyRefused = { reachable: 'no', because: 'key_refused' } as const;
    const outcomes = [
      dryRunWords?.outcome({ ...refused, caller_may: false }, asked),
      dryRunWords?.outcome({ ...refused, playbook_retired: true }, asked),
      dryRunWords?.outcome({ ...refused, allowed: false }, asked),
      dryRunWords?.outcome({ ...refused, server: keyRefused }, asked),
      dryRunWords?.outcome({ ...refused, server: { reachable: 'no', because: 'scope_lacking' } }, asked),
      dryRunWords?.outcome({ ...refused, server: { reachable: 'no', because: 'unreachable' } }, asked),
      dryRunWords?.outcome({ ...refused, server: { reachable: 'no', because: 'connection_not_allowed' } }, asked),
    ];
    const both = dryRunWords?.outcome({ ...refused, allowed: false, server: keyRefused }, asked);

    expect(distinct([...outcomes, dryRunWords?.outcome(wouldRun, asked)])).toBe(8);
    expect(distinct([both, outcomes[2], outcomes[3]])).toBe(3);
  });
});
