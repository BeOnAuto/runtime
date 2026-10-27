import {
  calledOpeningLinks,
  plainTextIn,
  retriedWith,
  stateAskedBy,
  toolNamesIn,
  withMcpSession,
  type LinkOpening,
} from '@on.auto/api/testing';
import { localDeveloper } from '@on.auto/identity/testing';
import { sha256Of } from '@on.auto/operations';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { ownKeyFactsIn, secretsKey } from '../testing/records/kept-credentials.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

let server: ReasoningServer;

beforeAll(async () => {
  server = await servingReasoning([]);
});

afterAll(async () => {
  await server.stop();
});

const notes = { type: 'mcp', entry: { url: 'https://notes.example.com/mcp' }, credential: { kind: 'none' } };

const AddedSchema = Schema.Struct({ connect: Schema.Struct({ url: Schema.String }) });

const PageSchema = Schema.Struct({ connection: Schema.String, token: Schema.String });

function adding(name: string, opening: Partial<LinkOpening> = {}) {
  const connection = { url: `${server.origin}/mcp`, headers: {} };
  return calledOpeningLinks(connection, { name: 'add_connection', arguments: { ...notes, name } }, opening);
}

function linkOn(url: string) {
  return Schema.decodeUnknownSync(PageSchema)(Object.fromEntries(new URL(url).searchParams));
}

function approving(url: string) {
  const { connection, token } = linkOn(url);
  return server.call('POST', `/v1/orgs/local/connections/${connection}/approve`, { body: { token } });
}

function cancelling(url: string) {
  return server.call('DELETE', `/v1/orgs/local/connections/${linkOn(url).connection}`);
}

function toolsOn(path: string): Promise<readonly string[]> {
  return withMcpSession('current revision', { url: `${server.origin}${path}`, headers: {} }, async (session) =>
    toolNamesIn(await session.listTools()),
  );
}

const connectionTools = ['add_connection', 'list_connections', 'reconnect_connection', 'remove_connection'];

describe('the tools of connections', () => {
  it('are four operations on /mcp and on the org endpoint, and neither get_connection nor any of the three of the link', async () => {
    const [own, org] = [await toolsOn('/mcp'), await toolsOn('/orgs/local/mcp')];

    expect([own, org].map((names) => names.filter((name) => name.includes('connection')))).toEqual([
      connectionTools,
      connectionTools,
    ]);
    expect(
      [...own, ...org].filter((name) => ['get_connection', 'read_link', 'approve', 'give_credential'].includes(name)),
    ).toEqual([]);
  });
});

describe('add_connection over MCP', () => {
  it('asks a client that opens links to open the page of the link, saying what to do, and answers the retry after a continue without approving with the link', async () => {
    const { answer, elicited } = await adding('notes-linked');

    const { url } = Schema.decodeUnknownSync(AddedSchema)(answer.structuredContent).connect;
    expect(elicited).toEqual([
      {
        mode: 'url',
        message:
          'Open this page to approve the connection “notes-linked”, and give its credential where it takes one, within ten minutes.',
        url,
      },
    ]);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/studio\/connect\?connection=[\da-f-]{36}&token=[\w-]{43}$/u);
    expect(answer.structuredContent).toMatchObject({ name: 'notes-linked', status: 'pending' });
    expect(plainTextIn(answer)).toBe(
      'Added the connection “notes-linked”. The person who added it approves it, and gives its credential where it takes one, on the page its link opens, within ten minutes; shown to them as a link named “Approve the connection”, never as its address.',
    );
  });

  it('asks nothing of a client that does not declare it opens links, or speaks 2025-11-25, and answers the link, with words that say to show it by a name', async () => {
    const formsAlone = await adding('notes-forms', { opens: 'forms alone' });
    const legacy = await adding('notes-legacy', { revision: 'previous revision' });

    const urls = [formsAlone, legacy].map(
      ({ answer }) => Schema.decodeUnknownSync(AddedSchema)(answer.structuredContent).connect.url,
    );
    expect([formsAlone.elicited, legacy.elicited]).toEqual([[], []]);
    expect(urls.filter((url) => /^http:\/\/127\.0\.0\.1:\d+\/studio\/connect\?connection=/u.test(url))).toHaveLength(2);
    expect(plainTextIn(legacy.answer)).toBe(
      'Added the connection “notes-legacy”. The person who added it approves it, and gives its credential where it takes one, on the page its link opens, within ten minutes; shown to them as a link named “Approve the connection”, never as its address.',
    );
  });
});

describe('the retry of add_connection after the page', () => {
  it('answers the connection connected after the person approved it on the page, with no link, in words that say nothing is left to open', async () => {
    const { answer } = await adding('notes-approved', { onThePage: approving });

    expect(answer.structuredContent).toMatchObject({
      name: 'notes-approved',
      status: 'connected',
      connected_by: { id: 'local', name: localDeveloper.name },
    });
    expect(answer.structuredContent).not.toHaveProperty('connect');
    expect(plainTextIn(answer)).toBe('Connected the connection “notes-approved”; nothing is left to open.');
  });

  it('answers the connection removed after the person cancelled on the page, in words that say nothing is connected', async () => {
    const { answer } = await adding('notes-cancelled', { onThePage: cancelling });

    expect(answer.structuredContent).toMatchObject({ name: 'notes-cancelled', status: 'removed' });
    expect(answer.structuredContent).not.toHaveProperty('connect');
    expect(plainTextIn(answer)).toBe(
      'The person cancelled the connection “notes-cancelled” on the page, so it is removed and nothing is connected.',
    );
  });

  it('answers the connection pending with its link after the person declined to open the page, in words that say they declined', async () => {
    const { answer } = await adding('notes-declined', { action: 'decline' });

    expect(Schema.decodeUnknownSync(AddedSchema)(answer.structuredContent).connect.url).toMatch(/\/studio\/connect\?/u);
    expect(answer.structuredContent).toMatchObject({ name: 'notes-declined', status: 'pending' });
    expect(plainTextIn(answer)).toMatch(
      /^The person declined to open the page, and its link is in this answer\. Added the connection “notes-declined”\. /u,
    );
  });
});

async function servedFor(environment: Readonly<Record<string, string>> = {}): Promise<ReasoningServer> {
  const served = await servingReasoning([], environment);
  const stopping: { done?: Promise<void> } = {};
  const stop = (): Promise<void> => {
    stopping.done ??= served.stop();
    return stopping.done;
  };
  onTestFinished(stop);
  return { ...served, stop };
}

function aLedgerFile(): string {
  const { fileName, remove } = temporaryLedger();
  onTestFinished(remove);
  return fileName;
}

function onMcpOf({ origin }: ReasoningServer) {
  return { url: `${origin}/mcp`, headers: {} };
}

function addingNotes(name: string) {
  return { name: 'add_connection', arguments: { ...notes, name } };
}

const sharing = { SECRETS_KEY: secretsKey.toString('base64') };

describe('the retry of add_connection', () => {
  it('is answered after a restart by the next server on the same ledger, under the key the runtime keeps for itself, adding nothing a second time', async () => {
    const fileName = aLedgerFile();
    const call = addingNotes('notes-across');
    const first = await servedFor({ ...sharing, LEDGER_FILE: fileName });
    const state = await stateAskedBy(onMcpOf(first), call);
    await first.stop();
    const next = await servedFor({ ...sharing, LEDGER_FILE: fileName });

    const retried = await retriedWith(onMcpOf(next), call, state);
    const listed = await next.call('GET', '/v1/orgs/local/connections');
    await next.stop();

    expect(retried.structuredContent).toMatchObject({
      name: 'notes-across',
      status: 'pending',
      added_by: { id: 'local', name: localDeveloper.name },
    });
    expect(listed.body).toMatchObject({ connections: [{ name: 'notes-across' }] });
    expect(await ownKeyFactsIn(fileName)).toMatchObject([
      { type: 'own_key_kept', data: { purpose: 'retry_state' }, context: { by: 'runtime' } },
    ]);
  });

  it('is answered across a rotation, by a server on the same ledger whose SECRETS_KEY_PREVIOUS is the key the first had', async () => {
    const fileName = aLedgerFile();
    const call = addingNotes('notes-rotated');
    const first = await servedFor({ ...sharing, LEDGER_FILE: fileName });
    const state = await stateAskedBy(onMcpOf(first), call);
    await first.stop();
    const rotated = await servedFor({
      LEDGER_FILE: fileName,
      SECRETS_KEY: Buffer.alloc(32, 9).toString('base64'),
      SECRETS_KEY_PREVIOUS: secretsKey.toString('base64'),
    });

    expect((await retriedWith(onMcpOf(rotated), call, state)).structuredContent).toMatchObject({
      name: 'notes-rotated',
    });
  });

  it('is refused by a server of another ledger, though it shares the SECRETS_KEY of the first', async () => {
    const [first, other] = [await servedFor(sharing), await servedFor(sharing)];
    const call = addingNotes('notes-elsewhere');

    const state = await stateAskedBy(onMcpOf(first), call);

    await expect(retriedWith(onMcpOf(other), call, state)).rejects.toThrow('Invalid or expired requestState');
  });
});

describe('a server whose secrets key cannot read the key the runtime keeps for itself', () => {
  it('does not start, naming the purpose of the key and the words of the store', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const first = await servedFor({ ...sharing, LEDGER_FILE: ledger.fileName });
    await first.stop();
    const anotherKey = Buffer.alloc(32, 9);

    const started = startServer(
      {
        HOST: '127.0.0.1',
        PORT: '0',
        LEDGER_FILE: ledger.fileName,
        PREDICTION_CACHE_DIR: ledger.cacheDirectory,
        SECRETS_KEY: anotherKey.toString('base64'),
      },
      compositionRoot,
    );

    await expect(started).rejects.toThrow(
      `The key the runtime keeps for retry_state cannot be read under the key that SECRETS_KEY holds: The secret is sealed under the key ${sha256Of(secretsKey).slice(0, 16)}, which is neither the current key nor the previous one. Start the server with the key the ledger's secrets were sealed under, or give that key as SECRETS_KEY_PREVIOUS, SECRETS_KEY_FILE_PREVIOUS or SECRETS_KEY_KMS_PREVIOUS beside a new key`,
    );
  });
});
