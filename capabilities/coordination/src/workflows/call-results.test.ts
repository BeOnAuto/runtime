import { describe, expect, it } from 'vitest';

import type { WorkflowEnding } from '../testing/endings.ts';
import type { DefinitionCallResult } from '../testing/run-terms.ts';
import { interpret, workflow } from '../testing/workflows.ts';

const calling = workflow(`
do:
  - lookup:
      try:
        - fetch:
            call: run_definition
            with: { type: reasoning, name: lookup, input: {} }
      catch:
        as: failure
        do:
          - report:
              set: '\${ $failure }'
`);

async function caughtFor(respond: () => DefinitionCallResult | Promise<DefinitionCallResult>): Promise<WorkflowEnding> {
  return (await interpret(calling, { respond })).ending;
}

const types = 'https://open-workflow-specification.org/spec/1.0.0/errors';

function unreachable(): Promise<DefinitionCallResult> {
  return Promise.reject(new Error('The call was lost', { cause: new Error('the host is gone') }));
}

describe('a rejected run', () => {
  it.each([
    ['invalid_input', 'validation', 400, 'refused its input'],
    ['forbidden', 'authorization', 403, 'was not allowed'],
    ['not_found', 'configuration', 404, 'could not be found'],
    ['conflict', 'runtime', 409, 'could not go through'],
    ['unavailable', 'communication', 503, 'was not available'],
    ['unheard_of', 'runtime', 500, 'did not go through'],
  ])('with %s is a %s error of status %d the document can catch', async (reason, kind, status, refused) => {
    expect(await caughtFor(() => ({ status: 'rejected', reason, detail: 'The model is busy' }))).toEqual({
      kind: 'completed',
      output: {
        type: `${types}/${kind}`,
        status,
        instance: '/do/0/lookup/try/0/fetch',
        title: `The reasoning function lookup ${refused}`,
        detail: 'The model is busy',
      },
    });
  });
});

const branching = workflow(`
do:
  - lookup:
      try:
        - fetch:
            call: run_definition
            with: { type: reasoning, name: lookup, input: {} }
      catch:
        when: '\${ $error.kind === "tool_not_offered" && $error.because === "tool_not_allowed" }'
        do:
          - report:
              set: { offered: false }
`);

function rejectedAs(kind: string): () => DefinitionCallResult {
  return () => ({ status: 'rejected', reason: 'unavailable', detail: 'No', kind, because: 'tool_not_allowed' });
}

describe('a rejected run that names its kind and because', () => {
  it('is an error the document can catch and branch on by its kind and because', async () => {
    const rejected = {
      status: 'rejected',
      reason: 'unavailable',
      detail: 'A tool server kept failing, after the run called the search tool of graph',
      kind: 'tools_unfinished',
      because: 'server_failed',
    } as const;

    expect(await caughtFor(() => rejected)).toEqual({
      kind: 'completed',
      output: {
        type: 'https://on.auto/problems/tools_unfinished',
        status: 503,
        instance: '/do/0/lookup/try/0/fetch',
        title: 'The reasoning function lookup was not available',
        detail: rejected.detail,
        kind: 'tools_unfinished',
        because: 'server_failed',
      },
    });
  });

  it('is caught by a condition on its kind, and passed on by one on another kind', async () => {
    expect((await interpret(branching, { respond: rejectedAs('tool_not_offered') })).ending).toEqual({
      kind: 'completed',
      output: { offered: false },
    });
    expect((await interpret(branching, { respond: rejectedAs('tool_server_failed') })).ending).toEqual({
      kind: 'failed',
      type: 'UncaughtError',
      message: 'The reasoning function lookup was not available, at the step fetch: No.',
    });
  });
});

const retryingCommunication = workflow(`
do:
  - lookup:
      try:
        - fetch:
            call: run_definition
            with: { type: reasoning, name: lookup, input: {} }
      catch:
        errors:
          with: { type: https://open-workflow-specification.org/spec/1.0.0/errors/communication }
        retry: { delay: PT1S, limit: { attempt: { count: 3 } } }
`);

describe('a run of a function that called tools and could not finish', () => {
  it('is not caught by a retry of communication errors, so its tools never run again under another id', async () => {
    const calls: string[] = [];
    const { ending } = await interpret(retryingCommunication, {
      respond: ({ run }) => {
        calls.push(`run ${run}`);
        return { status: 'rejected', reason: 'unavailable', detail: 'It stopped', kind: 'tools_unfinished' };
      },
    });

    expect(ending).toEqual({
      kind: 'failed',
      type: 'UncaughtError',
      message: 'The reasoning function lookup was not available, at the step fetch: It stopped.',
    });
    expect(calls).toEqual(['run 1']);
  });
});

const retryingRuntime = workflow(`
do:
  - lookup:
      try:
        - fetch:
            call: run_definition
            with: { type: reasoning, name: lookup, input: {} }
      catch:
        errors:
          with: { type: https://open-workflow-specification.org/spec/1.0.0/errors/runtime }
        retry: { delay: PT1S, limit: { attempt: { count: 3 } } }
`);

describe('a step that meets a run whose tools may have been called', () => {
  it('is not retried by a retry of runtime errors, and ends the run as a conflict of tools called', async () => {
    const calls: string[] = [];
    const { ending, settlement } = await interpret(retryingRuntime, {
      respond: ({ run }) => {
        calls.push(`run ${run}`);
        return { status: 'rejected', reason: 'conflict', detail: 'It may have called tools', kind: 'tools_called' };
      },
    });

    expect(calls).toEqual(['run 1']);
    expect(ending).toMatchObject({ kind: 'failed', type: 'UncaughtError' });
    expect(settlement).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The reasoning function lookup could not go through, at the step fetch: It may have called tools.',
      kind: 'tools_called',
    });
  });
});

describe('a step whose run the meter refuses because the account of its org is closed', () => {
  const closed = {
    status: 'rejected',
    reason: 'conflict',
    detail: 'The org acme was deleted for good',
    kind: 'account_closed',
    because: 'org_purged',
  } as const;

  it('raises a 409 of the type of account_closed, with its reason, which the document can catch', async () => {
    expect(await caughtFor(() => closed)).toEqual({
      kind: 'completed',
      output: {
        type: 'https://on.auto/problems/account_closed',
        status: 409,
        instance: '/do/0/lookup/try/0/fetch',
        title: 'The reasoning function lookup could not go through',
        detail: closed.detail,
        kind: 'account_closed',
        because: 'org_purged',
      },
    });
  });

  it('is not retried by a retry of runtime errors, and ends the workflow as that conflict, with its reason', async () => {
    const { settlement } = await interpret(retryingRuntime, { respond: () => closed });

    expect(settlement).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail:
        'The reasoning function lookup could not go through, at the step fetch: The org acme was deleted for good.',
      kind: 'account_closed',
      because: 'org_purged',
    });
  });
});

describe('a step whose run the meter refuses until an owner accepts Auto’s activation terms', () => {
  const unaccepted = {
    status: 'rejected',
    reason: 'conflict',
    detail:
      "Auto needs an owner of this runtime's org to accept its activation terms for self-hosted runtimes before this runtime's key activates or renews. An owner reads and accepts them at https://studio.on.auto/licenses?installation=0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a; then run this again.",
    kind: 'terms_required',
  } as const;

  it('raises a 409 of the type of terms_required, with the page in its detail, which the document can catch', async () => {
    expect(await caughtFor(() => unaccepted)).toEqual({
      kind: 'completed',
      output: {
        type: 'https://on.auto/problems/terms_required',
        status: 409,
        instance: '/do/0/lookup/try/0/fetch',
        title: 'The reasoning function lookup could not go through',
        detail: unaccepted.detail,
        kind: 'terms_required',
      },
    });
  });

  it('is not retried by a retry of runtime errors, and ends the workflow as that conflict', async () => {
    const { settlement } = await interpret(retryingRuntime, { respond: () => unaccepted });

    expect(settlement).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: `The reasoning function lookup could not go through, at the step fetch: ${unaccepted.detail}`,
      kind: 'terms_required',
    });
  });
});

describe('a failed run', () => {
  it('is a runtime error', async () => {
    expect(await caughtFor(() => ({ status: 'failed', detail: 'It failed with incident 7' }))).toEqual({
      kind: 'completed',
      output: {
        type: `${types}/runtime`,
        status: 500,
        instance: '/do/0/lookup/try/0/fetch',
        title: 'The reasoning function lookup failed',
        detail: 'It failed with incident 7',
      },
    });
  });

  it('is a communication error when the run could not be reached, with the chain of causes', async () => {
    expect(await caughtFor(unreachable)).toEqual({
      kind: 'completed',
      output: {
        type: `${types}/communication`,
        status: 503,
        instance: '/do/0/lookup/try/0/fetch',
        title: 'run_definition could not reach the reasoning function lookup',
        detail: 'Error: The call was lost: Error: the host is gone',
      },
    });
  });
});
