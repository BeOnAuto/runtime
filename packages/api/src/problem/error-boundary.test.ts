import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RegisterRoutes } from '../index.ts';
import { call, createTestHandler } from '../testing/api-calls.ts';
import { problemReasons, ProblemSchema, problemTypes } from './problem-document.ts';
import { problemOf } from './problem.ts';

const decodeProblem = Schema.decodeUnknownSync(ProblemSchema, { onExcessProperty: 'error' });

const { schema: problemJsonSchema } = Schema.toJsonSchemaDocument(ProblemSchema);

describe('the schema of a problem document', () => {
  it('accepts every problem the server makes, of each reason, and of a kind that has a type of its own', () => {
    const problems = [
      ...problemReasons.map((reason) => problemOf(reason, 'What happened')),
      problemOf('invalid_input', 'It does not fit', { errors: [{ detail: 'Expected a string', pointer: '/name' }] }),
      problemOf('unavailable', 'It stopped', { kind: 'tools_unfinished', because: 'server_failed' }),
      problemOf('forbidden', 'Your role in this organization does not allow that', { kind: 'permission_denied' }),
      problemOf('internal', 'It broke', { instance: 'urn:uuid:0190a000-0000-7000-8000-000000000000' }),
    ];

    expect(problems.map((problem) => decodeProblem(problem))).toEqual(problems);
  });

  it('holds the table of reasons, each with the status, the title and the words its problems carry', () => {
    expect(problemTypes.conflict).toEqual({
      status: 409,
      title: 'Conflict',
      description: 'The request clashes with what is there, such as a retired playbook',
    });
    expect(Object.keys(problemTypes)).toEqual(problemReasons);
    expect(problemReasons.map((reason) => problemOf(reason, 'Said').status)).toEqual(
      problemReasons.map((reason) => problemTypes[reason].status),
    );
  });

  it('is the JSON Schema of the document, its reasons each with its title and words, and its members required', () => {
    expect(problemJsonSchema).toMatchObject({
      type: 'object',
      required: ['type', 'title', 'status', 'detail', 'reason'],
      properties: {
        reason: {
          anyOf: problemReasons.map((reason) => ({
            enum: [reason],
            title: problemTypes[reason].title,
            description: problemTypes[reason].description,
          })),
        },
        status: { type: 'integer' },
      },
    });
  });
});

const uuid = /^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u;

const notAnError: Error = { name: 'Secret', message: 'database password is hunter2' };

const failing: RegisterRoutes = (routes) => {
  routes.add('GET', '/error', () => {
    throw new Error('database password is hunter2');
  });
  routes.add('GET', '/not-an-error', () => {
    throw notAnError;
  });
};

function internalProblemWith(incident: string | undefined): Readonly<Record<string, unknown>> {
  return {
    type: 'https://on.auto/problems/internal',
    title: 'Internal error',
    status: 500,
    detail: 'An unexpected error occurred',
    reason: 'internal',
    instance: `urn:uuid:${String(incident)}`,
  };
}

describe('an unexpected error', () => {
  it('answers 500 identified only by the urn:uuid of an incident, and reports the error under that id', async () => {
    const { handler, reported } = createTestHandler({ routes: [failing] });

    const answer = await call(handler, '/error');
    const [report] = reported;

    expect(answer.status).toBe(500);
    expect(report?.incident).toMatch(uuid);
    expect(answer.body).toEqual(internalProblemWith(report?.incident));
    expect(answer.text).not.toContain('hunter2');
    expect(reported).toEqual([
      {
        incident: report?.incident,
        requestId: answer.headers.get('x-request-id'),
        message: 'database password is hunter2',
      },
    ]);
    expect(answer.headers.get('x-request-id')).toMatch(uuid);
  });
});

describe('a thrown value that is not an Error', () => {
  it('answers the same 500 problem document, and reports an Error whose cause is the value', async () => {
    const { handler, reported } = createTestHandler({ routes: [failing] });

    const answer = await call(handler, '/not-an-error');
    const [report] = reported;

    expect(answer.status).toBe(500);
    expect(answer.headers.get('content-type')).toBe('application/problem+json');
    expect(report?.incident).toMatch(uuid);
    expect(answer.body).toEqual(internalProblemWith(report?.incident));
    expect(answer.text).not.toContain('hunter2');
    expect(reported).toEqual([
      {
        incident: report?.incident,
        requestId: answer.headers.get('x-request-id'),
        message: 'A value that is not an Error was thrown',
        cause: notAnError,
      },
    ]);
  });

  it('answers with the request id and the security headers every other response carries', async () => {
    const { handler } = createTestHandler({ routes: [failing] });

    const { headers } = await call(handler, '/not-an-error');

    expect(headers.get('x-request-id')).toMatch(uuid);
    expect({
      contentTypeOptions: headers.get('x-content-type-options'),
      frameOptions: headers.get('x-frame-options'),
      contentSecurityPolicy: headers.get('content-security-policy'),
      strictTransportSecurity: headers.get('strict-transport-security'),
    }).toEqual({
      contentTypeOptions: 'nosniff',
      frameOptions: 'DENY',
      contentSecurityPolicy: "default-src 'none'; frame-ancestors 'none'",
      strictTransportSecurity: null,
    });
  });
});
