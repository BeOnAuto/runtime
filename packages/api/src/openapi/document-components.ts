import { OrgIdSchema, PlaybookIdSchema } from '@on.auto/operations';
import { Schema } from 'effect';

import { ProblemSchema } from '../problem/problem-document.ts';
import { selfContainedSchemaOf } from '../tools/tool-schema.ts';
import { identifiedSchemaOf } from './operation-schemas.ts';
import type { OpenApiObject, ProblemAnswer } from './problem-responses.ts';

function scopeParameterOf(name: string, schema: Schema.Constraint, description: string): OpenApiObject {
  return { name, in: 'path', required: true, description, schema: Schema.toJsonSchemaDocument(schema).schema };
}

const problemSchema = identifiedSchemaOf(selfContainedSchemaOf(Schema.toJsonSchemaDocument(ProblemSchema)), 'problem');

const parameters = {
  org: scopeParameterOf('org', OrgIdSchema, "The id of the org, which is the caller's own"),
  playbook: scopeParameterOf('playbook', PlaybookIdSchema, 'The id of the playbook to act in'),
};

const bearer = {
  type: 'http',
  scheme: 'bearer',
  description: [
    'An API key, sent as Authorization: Bearer <key>.',
    'A key belongs to one org and holds permissions, such as playbook:read and playbook:write, for some or all of its playbooks.',
    'A server on a loopback address with neither PUBLIC_URL nor API_KEYS set is in local mode, and answers requests from its own machine without a key.',
  ].join(' '),
};

function securitySchemesOf(identityIssuer: string): OpenApiObject {
  return {
    bearer,
    openIdConnect: {
      type: 'openIdConnect',
      openIdConnectUrl: `${identityIssuer}/.well-known/openid-configuration`,
      description: [
        'An access token of the Auto identity service, sent as Authorization: Bearer <token>, for a person signed in there.',
        'A server whose PUBLIC_URL is set takes a token whose audience is that URL.',
        'The person acts in the org their organization in the identity service names, or, where their token names none, in the org whose id is their subject, over every playbook, with the permissions among the scopes their token was granted.',
        'Each permission that permits an operation is the scope of one of its requirements.',
      ].join(' '),
    },
  };
}

export function componentsOf(problems: readonly ProblemAnswer[], identityIssuer: string): OpenApiObject {
  const responses = problems.toSorted((one, other) => one.status - other.status);
  return {
    schemas: { problem: problemSchema },
    responses: Object.fromEntries(responses.map(({ name, response }) => [name, response])),
    parameters,
    securitySchemes: securitySchemesOf(identityIssuer),
  };
}
