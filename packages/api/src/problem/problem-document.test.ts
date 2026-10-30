import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProblemSchema, problemReasons, problemTypes } from './problem-document.ts';
import { problemOf } from './problem.ts';

const decodeProblem = Schema.decodeUnknownSync(ProblemSchema, { onExcessProperty: 'error' });

const { schema: problemJsonSchema } = Schema.toJsonSchemaDocument(ProblemSchema);

describe('the schema of a problem document', () => {
  it('accepts every problem the server makes, of each reason, and of a kind that has a type of its own', () => {
    const problems = [
      ...problemReasons.map((reason) => problemOf(reason, 'What happened')),
      problemOf('invalid_input', 'It does not fit', { errors: [{ detail: 'Expected a string', pointer: '/name' }] }),
      problemOf('unavailable', 'It stopped', { kind: 'tools_unfinished', because: 'server_failed' }),
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
