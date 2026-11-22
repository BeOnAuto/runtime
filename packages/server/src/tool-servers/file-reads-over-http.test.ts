import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { defaultTiming } from '@on.auto/tool-servers';
import { serveFakeApi } from '@on.auto/tool-servers/served-fakes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const apiKey = 'files-api-key-7d3a1c9e';

const builder = createApiKey({ id: 'acme-builder', org: 'acme', permissions: allPermissions, playbooks: '*' });

const callMs = 3000;

const stopped: unknown = expect.stringMatching(
  /\]\n(?:It took longer to read than the \d\.\d s the call had left|It took more memory to read than a process that reads a document may take), so its reading was stopped$|\]\nThe call ended before it was read$/u,
);

const closing: (() => Promise<void>)[] = [];

const shared: { server?: ReasoningServer } = {};

async function serving(): Promise<ReasoningServer> {
  const files = await serveFakeApi({ key: apiKey });
  closing.push(files.close);
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
  closing.push(server.stop);
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

/**
 * The read of the file, and whether the server answered its health while the read was still going: the file is read
 * in a process of its own, so the server answers in the meantime; a server that read it in its own thread would
 * answer the health only once the read had ended.
 */
async function readWhileAskingForHealth(server: ReasoningServer, fileName: string) {
  const reading: Reading = { read: false };
  const answered = fileOf(server, fileName).finally(() => {
    reading.read = true;
  });
  const { status } = await server.call('GET', '/health');
  const answeringWhileReading = status === 200 && !reading.read;
  return { answered: await answered, answeringWhileReading };
}

/*
 * The one file whose documents are read in the server's processes, which is what it shows: the reading is out of the
 * server's thread, and a process that reads too long or takes too much memory is stopped. Its cases share one server,
 * each reading its own file.
 */
beforeAll(async () => {
  shared.server = await serving();
});

afterAll(async () => {
  await Promise.all(closing.map((close) => close()));
});

function theServer(): ReasoningServer {
  if (shared.server === undefined) {
    throw new Error('The server of the file did not start');
  }
  return shared.server;
}

describe('the text of a file a tool of an HTTP API fetches, read by the server', () => {
  it('is read in a process of the server, its text answered', async () => {
    const server = theServer();

    expect(await fileOf(server, 'terms.txt')).toMatchObject({
      status: 200,
      body: {
        outcome: 'result',
        text: '[The file terms.txt, text/plain, 49 bytes]\nSupplier terms\nReturns are taken within 14 days.\n',
      },
    });
  });

  it('is stopped within the call for a PDF that draws its drawings within one another, the server answering all the while', async () => {
    const server = theServer();

    const { answered, answeringWhileReading } = await readWhileAskingForHealth(server, 'nested.pdf');

    expect(answered).toMatchObject({ status: 200, body: { outcome: 'result', text: stopped } });
    expect(answeringWhileReading).toBe(true);
    expect(await fileOf(server, 'terms.txt')).toMatchObject({ status: 200, body: { outcome: 'result' } });
  });

  it('is stopped within the call for a Word document that unpacks to far more than it takes, the server answering all the while', async () => {
    const server = theServer();

    const { answered, answeringWhileReading } = await readWhileAskingForHealth(server, 'unpacking.docx');

    expect(answered).toMatchObject({ status: 200, body: { outcome: 'result', text: stopped } });
    expect(answeringWhileReading).toBe(true);
    expect(await fileOf(server, 'terms.txt')).toMatchObject({ status: 200, body: { outcome: 'result' } });
  });
});
