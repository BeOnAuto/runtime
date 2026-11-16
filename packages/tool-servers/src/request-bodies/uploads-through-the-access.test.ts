import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { keptTextOf } from '@on.auto/content/testing';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { apiKey } from '../api-testing/api-calls.ts';
import { servedDocumentAt } from '../api-testing/described-documents.ts';
import { controlledSignals, describedAccess, patientTiming, recordingCallJournal, toolRun } from '../testing/index.ts';
import { serveFakeApi, type FakeApiServer } from '../testing/served-fakes.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const digest = (text: string) => createHash('sha256').update(text).digest('hex');

function uploadingDocument(fake: FakeApiServer): string {
  return JSON.stringify({
    openapi: '3.2.0',
    info: { title: 'Files', version: '1' },
    servers: [{ url: fake.baseUrl }],
    security: [{ apiKeyAuth: [] }],
    paths: {
      '/files': {
        post: {
          operationId: 'upload',
          parameters: [{ name: 'uploadType', in: 'query', required: true, schema: { enum: ['multipart'] } }],
          requestBody: {
            required: true,
            content: {
              'multipart/related': {
                schema: { type: 'array', prefixItems: [{ type: 'object' }, {}], minItems: 2 },
                prefixEncoding: [{ contentType: 'application/json' }, { contentType: '*/*' }],
              },
            },
          },
        },
      },
    },
    components: { securitySchemes: { apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key' } } },
  });
}

async function uploaded(input: Readonly<Record<string, unknown>>) {
  const fake = await serveFakeApi({ key: apiKey });
  closing.push(fake.close);
  const document = await servedDocumentAt(() => Promise.resolve(new Response(uploadingDocument(fake))));
  const { access, content } = await describedAccess(
    { files: { org: 'acme', document, security: { apiKeyAuth: '${FILES_API_KEY}' } } },
    { environment: { FILES_API_KEY: apiKey }, timing: patientTiming },
  );
  closing.push(access.close);
  fake.answerNextWith({ status: 200, headers: { 'content-type': 'application/json' }, body: '{"id":"file-1"}' });
  const journal = recordingCallJournal();
  const tools = await Effect.runPromise(access.open(toolRun(journal), [{ server: 'files', tool: 'upload' }]));
  closing.push(tools.close);
  const reply = await tools.offered[0]?.call({ callId: 'call-1', input }, controlledSignals());
  return {
    reply,
    fake,
    facts: journal.facts(),
    kept: (sha256: string) => keptTextOf(content, { org: 'acme', playbook: 'alpha' }, sha256),
  };
}

describe('a text a run uploads to an HTTP API as a part of a body', () => {
  const input = {
    uploadType: 'multipart',
    body: [{ name: 'Weekly report.md' }, { media_type: 'text/markdown', text: '# Week\n\nÉté, done 🙂' }],
  };

  it('goes out once, its length counted in bytes, its parts in order under the type of each', async () => {
    const { reply, fake } = await uploaded(input);
    const [sent] = fake.seen();
    const boundary = String(sent?.headers['content-type']).replace(/^multipart\/related; boundary=/u, '');
    const body = [
      `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n{"name":"Weekly report.md"}\r\n`,
      `--${boundary}\r\nContent-Type: text/markdown; charset=utf-8\r\n\r\n# Week\n\nÉté, done 🙂\r\n`,
      `--${boundary}--\r\n`,
    ].join('');

    expect(reply).toMatchObject({ outcome: 'result' });
    expect(fake.seen()).toHaveLength(1);
    expect(sent).toMatchObject({
      method: 'POST',
      path: '/v1/files',
      query: '?uploadType=multipart',
      body,
      headers: { 'content-length': String(Buffer.byteLength(body)), 'x-api-key': apiKey },
    });
  });

  it('is recorded as the arguments as written, the type beside the text, and none of the request the runtime built', async () => {
    const { facts, kept } = await uploaded(input);
    const written = JSON.stringify(input);
    const [started] = facts;

    expect(started).toEqual({
      number: 1,
      type: 'tool_call_started',
      data: {
        call_id: 'call-1',
        server: 'files',
        tool: 'upload',
        arguments_bytes: Buffer.byteLength(written),
        arguments_sha256: digest(written),
      },
    });
    expect(await kept(digest(written))).toBe(written);
  });
});
