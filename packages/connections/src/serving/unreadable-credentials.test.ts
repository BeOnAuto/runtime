import { custodianRefusal, memoryRows, type RecordingCustodian } from '@on.auto/secrets/testing';
import type { ConnectionSource, ConnectionUnready, OrgConnection } from '@on.auto/tool-servers';
import { fakeApiKey, serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { describedAccess, patientTiming, playbookToolCalls } from '@on.auto/tool-servers/testing';
import { DateTime, Effect, Fiber, Logger, Option, Redacted } from 'effect';
import { TestClock } from 'effect/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { added } from '../testing/additions.ts';
import { harness, loopbackPolicy } from '../testing/harness.ts';
import { givenThrough, sealedIn, sourceLoggingInto } from '../testing/sealed-connections.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const now = Effect.map(DateTime.now, DateTime.toEpochMillis);

async function fakeServerAt(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  closing.push(fake.close);
  return fake;
}

function graphAt({ url }: FakeMcpServer) {
  return {
    name: 'graph',
    type: 'mcp',
    entry: { url },
    credential: { kind: 'secret', name: 'Authorization', in: 'header', scheme: 'Bearer' },
  };
}

function loggedLines() {
  const lines: string[] = [];
  const logging = Logger.layer([
    Logger.map(Logger.formatJson, (line: string) => {
      lines.push(line);
    }),
  ]);
  return { lines, logging };
}

async function connectionOf(source: ConnectionSource, id: string): Promise<OrgConnection> {
  return Option.getOrThrow(
    Option.fromNullishOr((await Effect.runPromise(source.connectionsOf('acme'))).find((each) => each.id === id)),
  );
}

function servedOf({ state }: OrgConnection): Effect.Effect<unknown, ConnectionUnready> {
  return state.status === 'connected' ? state.server : Effect.fail(state.unready);
}

async function refusalOf(source: ConnectionSource, id: string): Promise<ConnectionUnready> {
  return Effect.runPromise(Effect.flip(servedOf(await connectionOf(source, id))));
}

const searched = { server: 'graph', tool: 'search', arguments: { query: 'acme' } };

function unreadableNow(detail: string): string {
  return `The credential of the connection graph cannot be read now: ${detail}`;
}

function refusedBy(custodian: RecordingCustodian): string {
  return unreadableNow(`The custodian of the key ${custodian.kid} refused to unwrap a data key: ${custodianRefusal}`);
}

function refusedCallBy(custodian: RecordingCustodian) {
  return {
    status: 'rejected',
    reason: 'unavailable',
    kind: 'tool_not_offered',
    because: 'connection_unavailable',
    detail: refusedBy(custodian),
  };
}

function warningsIn(lines: readonly string[]): readonly string[] {
  return lines.filter((line) => line.includes('"level":"WARN"'));
}

describe('a connection whose credential the secret store cannot read now', () => {
  it('fails a tool call in the words of the store, records nothing and stays connected, logs the cause once, and is called once the custodian answers again', async () => {
    const fake = await fakeServerAt();
    const h = harness({ policy: loopbackPolicy });
    const { custodian, store } = sealedIn(memoryRows({ now }));
    const id = await givenThrough(h, store, graphAt(fake), fakeApiKey);
    const pending = await added(h, { ...graphAt(fake), name: 'notes' });
    const { lines, logging } = loggedLines();
    const source = sourceLoggingInto(h, store, logging);
    const { access } = await describedAccess({}, { timing: patientTiming, connections: source });
    closing.push(access.close);
    const calls = playbookToolCalls(access);

    custodian.refuse();
    const refused = [await calls.call('execute', searched), await calls.call('execute', searched)];
    const listedWhileRefused = (await connectionOf(source, id)).state.status;
    custodian.answer();
    const answered = await calls.call('execute', searched);

    expect(refused).toEqual([refusedCallBy(custodian), refusedCallBy(custodian)]);
    expect(listedWhileRefused).toBe('connected');
    expect((await connectionOf(source, pending.id)).state.status).toBe('unready');
    expect(answered).toMatchObject({ status: 'succeeded' });
    expect((await h.facts()).map(({ type }) => type)).not.toContain('connection_broken');
    expect(warningsIn(lines)).toEqual([expect.stringContaining(`"message":"${refusedBy(custodian)}"`)]);
    expect(warningsIn(lines)[0]).toContain(`"annotations":{"org":"acme","connection":"${id}"}`);
    expect(lines.join('\n')).not.toContain(fakeApiKey);
  });
});

async function wrappedAgainBadly(rows: ReturnType<typeof memoryRows>, kid: string): Promise<void> {
  const [read] = await Effect.runPromise(rows.heldBy({ keptBy: 'ledger', kid }, 1));
  const held = Option.getOrThrow(Option.fromNullishOr(read));
  await Effect.runPromise(rows.reheld(held, { ...held.holding, wrappedKey: 'not a wrapping' }));
}

describe('the log of a credential that cannot be read now', () => {
  it('holds each cause once, by the failure and the key it names and not by its words, again when the cause changes, and again once a read succeeded between', async () => {
    const fake = await fakeServerAt();
    const h = harness({ policy: loopbackPolicy });
    const rows = memoryRows({ now });
    const { custodian, store } = sealedIn(rows);
    const id = await givenThrough(h, store, graphAt(fake), fakeApiKey);
    const secretId = String(rows.kept()[0]?.id);
    const other = sealedIn(rows);
    const { lines, logging } = loggedLines();
    const source = sourceLoggingInto(h, store, logging);

    custodian.refuse();
    const refusals = [await refusalOf(source, id), await refusalOf(source, id)];
    custodian.answer();
    await wrappedAgainBadly(rows, custodian.kid);
    refusals.push(await refusalOf(source, id));
    await Effect.runPromise(other.store.replace(secretId, 1, Redacted.make(fakeApiKey)));
    refusals.push(await refusalOf(source, id), await refusalOf(source, id));
    await Effect.runPromise(store.replace(secretId, 2, Redacted.make(fakeApiKey)));
    await Effect.runPromise(servedOf(await connectionOf(source, id)));
    custodian.refuse();
    refusals.push(await refusalOf(source, id));

    const keyUnknown = unreadableNow(
      `The secret is sealed under the key ${other.custodian.kid}, which is neither the current key nor the previous one`,
    );
    const unopened = unreadableNow(
      `The custodian of the key ${custodian.kid} refused to unwrap a data key: its wrapped key does not open under this key`,
    );
    expect(refusals).toEqual(
      [refusedBy(custodian), refusedBy(custodian), unopened, keyUnknown, keyUnknown, refusedBy(custodian)].map(
        (detail) => ({ because: 'connection_unavailable', detail }),
      ),
    );
    expect(warningsIn(lines).map((line) => [line.includes(keyUnknown), line.includes(unopened)])).toEqual([
      [false, false],
      [true, false],
      [false, false],
    ]);
  });
});

describe('a connection whose custodian does not answer', () => {
  it('is unavailable once the store has waited 10 seconds, and never broken', async () => {
    const fake = await fakeServerAt();
    const h = harness({ policy: loopbackPolicy });
    const { custodian, store } = sealedIn(memoryRows({ now }));
    const id = await givenThrough(h, store, graphAt(fake), fakeApiKey);
    const served = servedOf(await connectionOf(sourceLoggingInto(h, store, loggedLines().logging), id));

    const refused = await Effect.runPromise(
      Effect.gen(function* () {
        const asked = custodian.stall();
        const serving = yield* Effect.forkChild(Effect.flip(served));
        yield* Effect.promise(() => asked);
        yield* TestClock.adjust('10 seconds');
        return yield* Fiber.join(serving);
      }).pipe(Effect.provide(TestClock.layer())),
    );

    expect(refused).toEqual({
      because: 'connection_unavailable',
      detail: unreadableNow('The keeper of the secret, or the custodian of its key, did not answer within 10 seconds'),
    });
    expect((await h.facts()).map(({ type }) => type)).not.toContain('connection_broken');
  });
});
