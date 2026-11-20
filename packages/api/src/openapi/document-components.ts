import { OrgIdSchema, PlaybookIdSchema } from '@on.auto/operations';
import { Schema } from 'effect';

import { ProblemSchema } from '../problem/problem-document.ts';
import { selfContainedSchemaOf } from '../tools/tool-schema.ts';
import { identifiedSchemaOf } from './operation-schemas.ts';
import type { OpenApiObject, ProblemAnswer } from './problem-responses.ts';

export function scopeParameterOf(name: string, schema: Schema.Constraint, description: string): OpenApiObject {
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
    'Each permission that permits an operation is a role of one of its requirements.',
  ].join(' '),
};

function openIdConnectOf(authorizationServer: string): OpenApiObject {
  return {
    type: 'openIdConnect',
    openIdConnectUrl: `${authorizationServer}/.well-known/openid-configuration`,
    description: [
      'An access token of a person signed in at this server, sent as Authorization: Bearer <token>.',
      'This server is their OAuth 2.1 authorization server, which openIdConnectUrl describes.',
      'The person acts in the org whose id is default, over every playbook, with the permissions among the scopes their token was granted.',
      'Each permission that permits an operation is the scope of one of its requirements.',
    ].join(' '),
  };
}

function securitySchemesOf(authorizationServer: string | undefined): OpenApiObject {
  return authorizationServer === undefined
    ? { bearer }
    : { bearer, openIdConnect: openIdConnectOf(authorizationServer) };
}

export function componentsOf(
  problems: readonly ProblemAnswer[],
  authorizationServer: string | undefined,
): OpenApiObject {
  const responses = problems.toSorted((one, other) => one.status - other.status);
  return {
    schemas: { problem: problemSchema },
    responses: Object.fromEntries(responses.map(({ name, response }) => [name, response])),
    parameters,
    securitySchemes: securitySchemesOf(authorizationServer),
  };
}
