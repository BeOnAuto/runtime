import { authenticatorFor } from '@on.auto/identity';
import { defineCommand, type OfferedLink, type Outcome } from '@on.auto/operations';
import { Context, Effect, Redacted, Schema } from 'effect';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { calledOpeningLinks, retriedWith, stateAskedBy, type LinkOpening } from '../testing/elicited-calls.ts';
import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import { plainTextIn } from '../testing/mcp-clients.ts';
import {
  acmeAdmin,
  acmeAlphaWriter,
  operationServer,
  testRetryStateKeys,
  type OperationServer,
  type OperationServerOptions,
} from '../testing/operation-server.ts';
import { linkedAnswers, toolCallbackOf, type AnsweringServing } from './linked-answers.ts';

const opened = { times: 0 };

const usedUp: string[] = [];

const pageLastsMs = 60 * 60 * 1000;

function pageOf(made: number): string {
  return `https://studio.example/open?page=${String(made)}`;
}

const openPage = defineCommand('org', {
  name: 'open_page',
  title: 'Open page',
  description: 'Makes a page for the person to open. Use it when the person must act on a page. It answers the page.',
  route: { method: 'POST', path: '/pages' },
  inputSchema: Schema.Struct({ closed: Schema.optionalKey(Schema.Boolean) }),
  outputSchema: Schema.Struct({
    id: Schema.String,
    page: Schema.optionalKey(Schema.String),
    again: Schema.Boolean,
  }),
  reasons: [],
  handle: ({ closed = false }) =>
    Effect.sync(() => {
      opened.times += 1;
      const made = { id: `page-${String(opened.times)}`, again: false };
      return closed ? made : { ...made, page: pageOf(opened.times) };
    }),
  plainLanguage: {
    task: 'make a page',
    attempt: () => 'make a page',
    outcome: ({ page }) => (page === undefined ? 'Nothing is left to open.' : `Made ${page}.`),
  },
  linkToOpen: ({ page }) => (page === undefined ? undefined : { message: 'Open the page to approve it', url: page }),
  answerAfterTheLink: {
    idOf: ({ id }) => id,
    read: ({ id, url }) =>
      Effect.sync(() => (usedUp.includes(url) ? { id, again: true } : { id, page: url, again: true })),
    linkLastsMs: pageLastsMs,
  },
});

let server: OperationServer;
let listening: Listening;

beforeAll(async () => {
  server = await operationServer({ operations: [openPage] });
  listening = await listenOnLoopback(server.handler);
});

afterAll(async () => {
  await listening.close();
  await server.runtime.dispose();
});

function opening(how: Partial<LinkOpening> = {}, input: Readonly<Record<string, unknown>> = {}) {
  const connection = { url: `${listening.origin}/mcp`, headers: { authorization: `Bearer ${acmeAdmin.key}` } };
  return calledOpeningLinks(connection, { name: 'open_page', arguments: input }, how);
}

describe('a tool whose operation gives a link to open', () => {
  it('asks a client of 2026-07-28 that opens links to open it, with its message, and answers the retry with what its read gives, running the operation once', async () => {
    const made = opened.times + 1;

    const { answer, elicited } = await opening();

    expect(elicited).toEqual([{ mode: 'url', message: 'Open the page to approve it', url: pageOf(made) }]);
    expect(answer.structuredContent).toEqual({ id: `page-${String(made)}`, page: pageOf(made), again: true });
    expect(plainTextIn(answer)).toBe(`Made ${pageOf(made)}.`);
    expect(opened.times).toBe(made);
  });

  it('answers the retry after the page was used up with what its read gives then, no link, in its words', async () => {
    const made = opened.times + 1;

    const { answer } = await opening({
      onThePage: (url) => {
        usedUp.push(url);
        return Promise.resolve();
      },
    });

    expect(answer.structuredContent).toEqual({ id: `page-${String(made)}`, again: true });
    expect(plainTextIn(answer)).toBe('Nothing is left to open.');
  });

  it('says the person declined to open the page, and that its link is in the answer, when they declined or cancelled', async () => {
    const declined = await opening({ action: 'decline' });
    const cancelled = await opening({ action: 'cancel' });

    expect([declined, cancelled].map(({ elicited }) => elicited)).toHaveLength(2);
    expect([declined, cancelled].map(({ answer }) => plainTextIn(answer))).toEqual([
      `The person declined to open the page, and its link is in this answer. Made ${pageOf(opened.times - 1)}.`,
      `The person declined to open the page, and its link is in this answer. Made ${pageOf(opened.times)}.`,
    ]);
    expect(cancelled.answer.structuredContent).toMatchObject({ page: pageOf(opened.times), again: true });
  });
});

describe('a tool whose operation gives a link to open, to a client that is not asked to open it', () => {
  it('answers at once, with the link in the answer, a client that does not open links or speaks 2025-11-25', async () => {
    const formsAlone = await opening({ opens: 'forms alone' });
    const legacy = await opening({ revision: 'previous revision' });

    expect([formsAlone.elicited, legacy.elicited]).toEqual([[], []]);
    expect([formsAlone.answer.structuredContent, legacy.answer.structuredContent]).toEqual([
      { id: `page-${String(opened.times - 1)}`, page: pageOf(opened.times - 1), again: false },
      { id: `page-${String(opened.times)}`, page: pageOf(opened.times), again: false },
    ]);
  });

  it('answers at once, and asks nothing, where its answer holds no link to open', async () => {
    const { answer, elicited } = await opening({}, { closed: true });

    expect(elicited).toEqual([]);
    expect(answer.structuredContent).toEqual({ id: `page-${String(opened.times)}`, again: false });
  });
});

const words = {
  kind: 'command',
  plainLanguage: { attempt: () => 'make a page', outcome: () => 'Made it.', remedies: {} },
  dispatch: () => Effect.succeed<Outcome>({ status: 'succeeded', output: { by: 'the call' } }),
  operationInputOf: () => ({}),
  link: {
    toOpen: () => ({ message: 'Open', url: pageOf(0) }),
    idOf: () => 'page-0',
    dispatchAfter:
      ({ id, url }: OfferedLink) =>
      () =>
        Effect.succeed<Outcome>({ status: 'succeeded', output: { by: 'the read', id, url } }),
    linkLastsMs: pageLastsMs,
  },
} as const;

function replaying(keptFor: Readonly<Record<string, string>>) {
  const serving: AnsweringServing = {
    runCall: server.runtime.run,
    reportThrown: () => ({ status: 'failed', incident: 'offered-links' }),
    linkedAnswers: linkedAnswers(testRetryStateKeys),
  };
  const caller = { id: 'acme-admin', name: 'acme-admin', org: 'acme', permissions: [], playbooks: '*' } as const;
  const kept = { tool: 'open_page', caller: 'acme-admin', org: 'acme', id: 'page-0', url: pageOf(0), ...keptFor };
  return toolCallbackOf(
    serving,
    { caller, org: 'acme', requestId: 'request', dropped: [], context: Context.empty() },
    { ...words, name: 'open_page' },
  )({}, { mcpReq: { id: 1, signal: new AbortController().signal, requestState: () => kept } });
}

describe('a link offered before a retry', () => {
  it('is read after only for the tool, the caller and the org it was offered to, and otherwise the call runs', async () => {
    const theCall = { structuredContent: { by: 'the call' } };

    expect(await replaying({})).toEqual({
      content: [
        { type: 'text', text: 'Made it.' },
        { type: 'text', text: JSON.stringify({ by: 'the read', id: 'page-0', url: pageOf(0) }) },
      ],
      structuredContent: { by: 'the read', id: 'page-0', url: pageOf(0) },
    });
    expect(await replaying({ tool: 'other_page' })).toMatchObject(theCall);
    expect(await replaying({ caller: 'acme-reader' })).toMatchObject(theCall);
    expect(await replaying({ org: 'globex' })).toMatchObject(theCall);
  });
});

const openingThePage = { name: 'open_page', arguments: {} };

const servers: Listening[] = [];

afterAll(async () => {
  await Promise.all(servers.map((other) => other.close()));
});

async function anotherServer(options: OperationServerOptions = {}): Promise<string> {
  const other = await listenOnLoopback((await operationServer({ operations: [openPage], ...options })).handler);
  servers.push(other);
  return other.origin;
}

function keyed(origin: string, key: string = acmeAdmin.key) {
  return { url: `${origin}/mcp`, headers: { authorization: `Bearer ${key}` } };
}

const refusedState = 'Invalid or expired requestState';

const anotherKey = Redacted.make(new Uint8Array(32).fill(9));

describe('the retry of a tool that asked to open a link', () => {
  it('is answered by another server of the same key with what the read gives, and runs the operation once', async () => {
    const other = await anotherServer();
    const made = opened.times + 1;

    const state = await stateAskedBy(keyed(listening.origin), openingThePage);
    const retried = await retriedWith(keyed(other), openingThePage, state);

    expect(retried.structuredContent).toEqual({ id: `page-${String(made)}`, page: pageOf(made), again: true });
    expect(opened.times).toBe(made);
  });

  it('is refused by a server of another key, and to another caller, whose binding differs', async () => {
    const otherKey = await anotherServer({ retryStateKeys: { current: anotherKey } });
    const state = await stateAskedBy(keyed(listening.origin), openingThePage);

    await expect(retriedWith(keyed(otherKey), openingThePage, state)).rejects.toThrow(refusedState);
    await expect(retriedWith(keyed(listening.origin, acmeAlphaWriter.key), openingThePage, state)).rejects.toThrow(
      refusedState,
    );
  });

  it('is refused in another org to the same caller', async () => {
    const local = await anotherServer({ authenticator: authenticatorFor({ host: '127.0.0.1', apiKeys: undefined }) });
    const inAcme = { url: `${local}/orgs/acme/mcp`, headers: {} };
    const state = await stateAskedBy(inAcme, openingThePage);

    await expect(retriedWith({ ...inAcme, url: `${local}/orgs/globex/mcp` }, openingThePage, state)).rejects.toThrow(
      refusedState,
    );
    expect(await retriedWith(inAcme, openingThePage, state)).toMatchObject({ structuredContent: { again: true } });
  });
});

describe('the retry of a tool across a rotation of the key', () => {
  it('is answered by a server of the new key that keeps the old one as its previous, and a state of its own too', async () => {
    const rotated = await anotherServer({
      retryStateKeys: { current: anotherKey, previous: testRetryStateKeys.current },
    });

    const before = await stateAskedBy(keyed(listening.origin), openingThePage);
    const after = await stateAskedBy(keyed(rotated), openingThePage);

    expect(await retriedWith(keyed(rotated), openingThePage, before)).toMatchObject({
      structuredContent: { again: true },
    });
    expect(await retriedWith(keyed(rotated), openingThePage, after)).toMatchObject({
      structuredContent: { again: true },
    });
    await expect(retriedWith(keyed(listening.origin), openingThePage, after)).rejects.toThrow(refusedState);
  });
});

const askedAt = Date.UTC(2026, 9, 15, 14);

const tenMinutesMs = 10 * 60 * 1000;

describe('the retry of a tool as long after it asked as its link lasts', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is answered until ten minutes after the link offered ends, and refused a second later', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(askedAt);
    const state = await stateAskedBy(keyed(listening.origin), openingThePage);

    vi.setSystemTime(askedAt + pageLastsMs + tenMinutesMs);
    const atTheEnd = await retriedWith(keyed(listening.origin), openingThePage, state);
    vi.setSystemTime(askedAt + pageLastsMs + tenMinutesMs + 1000);

    expect(atTheEnd).toMatchObject({ structuredContent: { again: true } });
    await expect(retriedWith(keyed(listening.origin), openingThePage, state)).rejects.toThrow(refusedState);
  });
});
