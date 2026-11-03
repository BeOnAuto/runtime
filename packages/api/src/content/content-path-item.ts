import { contentAddressLastsSeconds } from '@on.auto/identity';
import { OrgIdSchema, PlaybookIdSchema } from '@on.auto/operations';

import { scopeParameterOf } from '../openapi/document-components.ts';
import { problemAnswersOf, referencesTo, type OpenApiObject } from '../openapi/problem-responses.ts';

export const contentPath = '/orgs/{org}/playbooks/{playbook}/content/{sha256}';

export const contentTag = 'content';

export const contentProblems = problemAnswersOf(
  new Set(['forbidden', 'not_found', 'method_not_allowed', 'range_not_satisfiable', 'internal']),
);

const hex = { type: 'string', pattern: '^[0-9a-f]{64}$' };

const description = [
  'Answers the bytes of a content a playbook keeps, with the media type it was kept with, at an address the runtime signed for that content.',
  `The address is what a browser follows, so it needs no credential: its signature and the time it lasts until are its credential, and it lasts ${String(contentAddressLastsSeconds / 60)} minutes at the most.`,
  'An address past its time, or not signed for this content, is refused as forbidden.',
  'One range of bytes asked in Range, from a first byte to a last or to the end, is answered with that part, and any other range with the whole content.',
].join(' ');

const parameters = [
  scopeParameterOf('org', OrgIdSchema, 'The id of the org whose playbook keeps the content'),
  scopeParameterOf('playbook', PlaybookIdSchema, 'The id of the playbook that keeps the content'),
  {
    name: 'sha256',
    in: 'path',
    required: true,
    description: "The SHA-256 of the content's bytes, in lowercase hex",
    schema: hex,
  },
  {
    name: 'until',
    in: 'query',
    required: true,
    description: 'The time the address lasts until, in whole seconds since 1970-01-01T00:00:00Z',
    schema: { type: 'integer', minimum: 0 },
  },
  {
    name: 'sig',
    in: 'query',
    required: true,
    description: 'The signature the runtime made of the org, the playbook, the digest and the time, in lowercase hex',
    schema: hex,
  },
  {
    name: 'Range',
    in: 'header',
    required: false,
    description: 'One range of bytes, bytes=<first>-<last> or bytes=<first>- to the end, counted from 0',
    schema: { type: 'string' },
  },
];

function headerOf(words: string): OpenApiObject {
  return { description: words, schema: { type: 'string' } };
}

const cacheControl = headerOf('private, with a max-age of the seconds the address has left');

const acceptRanges = headerOf('bytes, as every answer of the content says');

const bytes = {
  description: "The content's bytes, with the media type it was kept with as their Content-Type",
  headers: { 'Cache-Control': cacheControl, 'Accept-Ranges': acceptRanges },
  content: { '*/*': {} },
};

const part = {
  description: 'The bytes of the range asked, to the end of the content at the most, with its media type',
  headers: {
    'Content-Range': headerOf('bytes <first>-<last>/<size>, the part answered and the size of the whole'),
    'Cache-Control': cacheControl,
    'Accept-Ranges': acceptRanges,
  },
  content: { '*/*': {} },
};

export const contentPathItem: OpenApiObject = {
  get: {
    operationId: 'get_content',
    summary: 'Get content',
    description,
    tags: [contentTag],
    parameters,
    responses: { 200: bytes, 206: part, ...referencesTo(contentProblems) },
    security: [],
  },
};
