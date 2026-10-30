import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { defaultTiming } from '@on.auto/tool-servers';
import { serveFakeApi } from '@on.auto/tool-servers/served-fakes';
import { describe, expect, it, onTestFinished } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const apiKey = 'files-api-key-7d3a1c9e';

const builder = createApiKey({ id: 'acme-builder', org: 'acme', permissions: allPermissions, playbooks: '*' });

const callMs = 3000;

const stopped: unknown = expect.stringMatching(
  /\]\n(?:It took longer to read than the \d\.\d s the call had left|It took more memory to read than a process that reads a document may take), so its reading was stopped$|\]\nThe call ended before it was read$/u,
);

async function serving(): Promise<ReasoningServer> {
  const files = await serveFakeApi({ key: apiKey });
  onTestFinished(files.close);
  const server = await servingReasoning(
    [],
    {
      API_KEYS: JSON.stringify([builder.entry]),
      FILES_API_KEY: apiKey,
      TOOL_SERVERS: JSON.stringify({
        files: { document: files.documentUrl, security: { apiKeyAuth: '${FILES_API_KEY}' }, org: 'acme' },
      }),
    },
    undefined,
    { toolTiming: { ...defaultTiming, callMs } },
  );
  onTestFinished(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', {
    key: builder.key,
    body: { playbook: 'alpha', name: 'Alpha' },
  });
  return server;
}

function fileOf(server: ReasoningServer, fileName: string) {
  return server.call('POST', `${alpha}/tool-servers/files/tools/file/execute`, {
    key: builder.key,
    body: { arguments: { fileName } },
  });
}

interface Reading {
  read: boolean;
}

async function longestHealthWait(server: ReasoningServer, reading: Readonly<Reading>, longest = 0): Promise<number> {
  if (reading.read) {
    return longest;
  }
  const asked = performance.now();
  const { status } = await server.call('GET', '/health');
  const waited = status === 200 ? performance.now() - asked : Number.POSITIVE_INFINITY;
  return longestHealthWait(server, reading, Math.max(longest, waited));
}

async function readWhileAskingForHealth(server: ReasoningServer, fileName: string) {
  const started = performance.now();
  const reading: Reading = { read: false };
  const answered = fileOf(server, fileName).finally(() => {
    reading.read = true;
  });
  const longestWait = await longestHealthWait(server, reading);
  return { answered: await answered, took: performance.now() - started, longestWait };
}

describe('the text of a file a tool of an HTTP API fetches, read by the server', () => {
  it('is read in a process of the server, its text answered', async () => {
    const server = await serving();

    expect(await fileOf(server, 'terms.txt')).toMatchObject({
      status: 200,
      body: {
        outcome: 'result',
        text: '[The file terms.txt, text/plain, 49 bytes]\nSupplier terms\nReturns are taken within 14 days.\n',
      },
    });
  });

  it('is stopped within the call for a PDF that draws its drawings within one another, the server answering all the while', async () => {
    const server = await serving();

    const { answered, took, longestWait } = await readWhileAskingForHealth(server, 'nested.pdf');

    expect(answered).toMatchObject({ status: 200, body: { outcome: 'result', text: stopped } });
    expect({ inTime: took < callMs + 3000, answering: longestWait < 1000 }).toEqual({ inTime: true, answering: true });
    expect(await fileOf(server, 'terms.txt')).toMatchObject({ status: 200, body: { outcome: 'result' } });
  });

  it('is stopped within the call for a Word document that unpacks to far more than it takes, the server answering all the while', async () => {
    const server = await serving();

    const { answered, took, longestWait } = await readWhileAskingForHealth(server, 'unpacking.docx');

    expect(answered).toMatchObject({ status: 200, body: { outcome: 'result', text: stopped } });
    expect({ inTime: took < callMs + 3000, answering: longestWait < 1000 }).toEqual({ inTime: true, answering: true });
    expect(await fileOf(server, 'terms.txt')).toMatchObject({ status: 200, body: { outcome: 'result' } });
  });
});
