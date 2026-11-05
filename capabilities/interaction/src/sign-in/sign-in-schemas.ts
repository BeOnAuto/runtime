import { compileJsonSchema } from '@on.auto/json-schema';
import { mostValueDepth } from '@on.auto/workflow-engine/dsl';
import { Result, type Schema } from 'effect';

export const signInTool = 'browser_sign_in';

const mostReasonCharacters = 500;

export const signedInSchema: Schema.JsonObject = {
  type: 'object',
  required: ['signed_in'],
  properties: { signed_in: { const: true } },
  additionalProperties: false,
};

export const signedIn: Schema.JsonObject = { signed_in: true };

export const signInAnswerSchema: Schema.JsonObject = {
  type: 'object',
  required: ['signed_in'],
  properties: {
    signed_in: {
      type: 'boolean',
      description:
        'false when the person will not sign in; true is answered once the person has signed in through the link, from their own session, never by an agent',
    },
    reason: {
      type: 'string',
      maxLength: mostReasonCharacters,
      description: 'Why the person did not sign in, in their words',
    },
  },
  additionalProperties: false,
};

export const compiledSignedIn = Result.getOrThrow(
  compileJsonSchema(signedInSchema, { what: 'output', nesting: mostValueDepth }),
);
