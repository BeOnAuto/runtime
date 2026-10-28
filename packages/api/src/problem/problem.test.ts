import { describe, expect, it } from 'vitest';

import { problemOf, problemResponse, type ProblemReason } from '../index.ts';

const statusAndTitleByReason: ReadonlyArray<readonly [ProblemReason, number, string]> = [
  ['invalid_input', 422, 'Invalid input'],
  ['forbidden', 403, 'Forbidden'],
  ['not_found', 404, 'Not found'],
  ['conflict', 409, 'Conflict'],
  ['unavailable', 503, 'Unavailable'],
  ['cancelled', 409, 'Cancelled'],
  ['unanswered', 410, 'Unanswered'],
  ['client_closed_request', 499, 'Client closed request'],
  ['bad_request', 400, 'Bad request'],
  ['unauthenticated', 401, 'Unauthenticated'],
  ['origin_not_allowed', 403, 'Origin not allowed'],
  ['method_not_allowed', 405, 'Method not allowed'],
  ['length_required', 411, 'Length required'],
  ['content_too_large', 413, 'Content too large'],
  ['unsupported_media_type', 415, 'Unsupported media type'],
  ['internal', 500, 'Internal error'],
];

describe('problemOf', () => {
  it.each(statusAndTitleByReason)('describes %s with status %i and the title "%s"', (reason, status, title) => {
    expect(problemOf(reason, 'What happened')).toEqual({
      type: `https://on.auto/problems/${reason}`,
      title,
      status,
      detail: 'What happened',
      reason,
    });
  });

  it('describes a run that called tools and could not finish with a type of its own, and any other kind by its reason', () => {
    expect(problemOf('unavailable', 'It stopped', { kind: 'tools_unfinished', because: 'server_failed' })).toEqual({
      type: 'https://on.auto/problems/tools_unfinished',
      title: 'Tools unfinished',
      status: 503,
      detail: 'It stopped',
      reason: 'unavailable',
      kind: 'tools_unfinished',
      because: 'server_failed',
    });
    expect(problemOf('conflict', 'Called before', { kind: 'tools_called' })).toEqual({
      type: 'https://on.auto/problems/tools_called',
      title: 'Tools called',
      status: 409,
      detail: 'Called before',
      reason: 'conflict',
      kind: 'tools_called',
    });
    expect(problemOf('unavailable', 'Not offered', { kind: 'tool_not_offered' })).toMatchObject({
      type: 'https://on.auto/problems/unavailable',
      title: 'Unavailable',
    });
  });

  it('carries the issues that point at invalid input', () => {
    const errors = [{ detail: 'Expected a string', pointer: '/name' }];

    expect(problemOf('invalid_input', 'The input is invalid', { errors })).toMatchObject({ errors });
  });
});

function retryAfterOf(members: Parameters<typeof problemOf>[2]): string | null {
  return problemResponse(problemOf('unavailable', 'It cannot run', members)).headers.get('retry-after');
}

describe('problemResponse', () => {
  it('answers with the problem status, the problem media type and the document as JSON', async () => {
    const problem = problemOf('conflict', 'The name is taken');
    const response = problemResponse(problem);

    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(problem);
  });

  it('asks the client to retry an unavailable server after 5 seconds, and no other problem', () => {
    const unavailable = problemResponse(problemOf('unavailable', 'The server is stopping'));
    const conflict = problemResponse(problemOf('conflict', 'The name is taken'));

    expect([unavailable.headers.get('retry-after'), conflict.headers.get('retry-after')]).toEqual(['5', null]);
  });

  it('asks for no retry of a run that called tools, which the same request answers with tools_called', () => {
    expect(retryAfterOf({ kind: 'tools_unfinished', because: 'model_unavailable' })).toBeNull();
  });

  it('asks for no retry of a tool or a model not offered, which only a change of the function or the configuration resolves', () => {
    expect([
      retryAfterOf({ kind: 'tool_not_offered', because: 'tool_not_allowed' }),
      retryAfterOf({ kind: 'model_not_offered', because: 'model_not_allowed' }),
      retryAfterOf({ kind: 'model_not_offered', because: 'provider_not_configured' }),
    ]).toEqual([null, null, null]);
  });

  it('asks for a retry of a tool server that could not be used, which a retry may find working', () => {
    expect(retryAfterOf({ kind: 'tool_server_failed', because: 'unreachable' })).toBe('5');
  });

  it('adds the headers it is given', () => {
    const response = problemResponse(problemOf('method_not_allowed', 'Not here'), { allow: 'GET, HEAD' });

    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });
});

describe('the retry of a refusal of a prediction function', () => {
  it('asks for a retry of a prediction function whose builds or model processes are all taken, or whose dataset is not ready', () => {
    expect([
      retryAfterOf({ kind: 'builds_full' }),
      retryAfterOf({ kind: 'dataset_not_ready' }),
      retryAfterOf({ kind: 'model_process_busy' }),
      retryAfterOf({ kind: 'model_process_failed' }),
    ]).toEqual(['5', '5', '5', '5']);
  });

  it('asks for no retry of a prediction function whose builds of the day are spent, whose dataset stalled, whose model answers what it cannot or whose model no runtime executes', () => {
    expect([
      retryAfterOf({ kind: 'builds_full', because: 'builds_of_the_day' }),
      retryAfterOf({ kind: 'dataset_not_ready', because: 'stalled' }),
      retryAfterOf({ kind: 'model_process_failed', because: 'not_finite' }),
      retryAfterOf({ kind: 'model_process_failed', because: 'no_model_runtime' }),
    ]).toEqual([null, null, null, null]);
  });
});

describe('a cancelled run', () => {
  it('is described by a type of its own with its kind, and asks for no retry, since the same request answers it again', () => {
    const problem = problemOf('cancelled', 'The step ran out of time', { kind: 'deadline' });

    expect(problem).toEqual({
      type: 'https://on.auto/problems/cancelled',
      title: 'Cancelled',
      status: 409,
      detail: 'The step ran out of time',
      reason: 'cancelled',
      kind: 'deadline',
    });
    expect(problemResponse(problem).headers.get('retry-after')).toBeNull();
  });
});

describe('a request nobody answered', () => {
  it('is gone, by a type of its own with its kind, and asks for no retry, since the same request answers it again', () => {
    const problem = problemOf('unanswered', 'Nobody answered before the request expired', { kind: 'expired' });

    expect(problem).toEqual({
      type: 'https://on.auto/problems/unanswered',
      title: 'Unanswered',
      status: 410,
      detail: 'Nobody answered before the request expired',
      reason: 'unanswered',
      kind: 'expired',
    });
    expect(problemResponse(problem).headers.get('retry-after')).toBeNull();
  });
});

describe('room for a request the server cannot give', () => {
  it('asks for a retry once the playbook has room for a request', () => {
    expect(retryAfterOf({ kind: 'requests_full' })).toBe('5');
  });
});

describe('a view still being built', () => {
  it('describes a view still being built with a type of its own, and asks for a retry of it', () => {
    expect(problemOf('unavailable', 'It is rebuilding', { kind: 'rebuilding' })).toEqual({
      type: 'https://on.auto/problems/rebuilding',
      title: 'Rebuilding',
      status: 503,
      detail: 'It is rebuilding',
      reason: 'unavailable',
      kind: 'rebuilding',
    });
    expect(retryAfterOf({ kind: 'rebuilding' })).toBe('5');
  });
});

describe('a run refused because the account of its org is closed', () => {
  it('is described at 409 under a type of its own, with its reason and where to resolve it, and asks for no retry', () => {
    const closed = problemOf('conflict', 'The org acme was deleted; an owner can restore it', {
      kind: 'account_closed',
      because: 'org_deleted',
      resolve_at: 'https://studio.example.com/orgs/acme',
    });

    expect(closed).toEqual({
      type: 'https://on.auto/problems/account_closed',
      title: 'Account closed',
      status: 409,
      detail: 'The org acme was deleted; an owner can restore it',
      reason: 'conflict',
      kind: 'account_closed',
      because: 'org_deleted',
      resolve_at: 'https://studio.example.com/orgs/acme',
    });
    expect(problemResponse(closed).headers.get('retry-after')).toBeNull();
  });
});

describe('a run whose tool may have changed something', () => {
  it('is described at 409 under a type of its own, with its because, and asks for no retry', () => {
    const unknown = problemOf('conflict', 'It may have posted', { kind: 'effect_unknown', because: 'tool_error' });

    expect(unknown).toEqual({
      type: 'https://on.auto/problems/effect_unknown',
      title: 'Effect unknown',
      status: 409,
      detail: 'It may have posted',
      reason: 'conflict',
      kind: 'effect_unknown',
      because: 'tool_error',
    });
    expect(problemResponse(unknown).headers.get('retry-after')).toBeNull();
  });
});
