import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { ToolAccess } from '../access/tool-access.ts';
import { fakeConnections, pendingWords, refusedWords, type FakeConnections } from '../testing/fake-connections.ts';
import { describedAccess, type ReportingAccess } from '../testing/reporting-access.ts';
import { controlledSignals, recordingCallJournal, toolRun } from '../testing/tool-runs.ts';
import { until } from '../testing/until.ts';
import { behaviourKey, type ServedUnderTest, type ServerUnderTest } from './servers-under-test.ts';
import { behaviourConnection } from './sources-under-test.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const environment = { GRAPH_API_KEY: behaviourKey };

const timing = { callMs: 20_000, openMs: 20_000, longestRetryWaitMs: 1000 };

const reused = '0199e7c2-8c4d-7a1b-8e2f-3d4c5b6a7980';

const listedTools: unknown = expect.any(Array);

const brokenWords =
  'The credential of the connection wiki cannot be read: it is sealed under a key the runtime no longer has; remove the connection and add it again';

const ruleWords = 'A connection may not take a secret credential on this runtime, which allows none';

const takenWords =
  "The runtime's configuration sets up a tool server named graph, so a connection cannot take that name; remove it and add it again under another name";

interface Connected extends ReportingAccess {
  readonly fake: ServedUnderTest;
  readonly connections: FakeConnections;
}

type Files = (fake: ServedUnderTest) => Readonly<Record<string, unknown>>;

async function connectedTo(underTest: ServerUnderTest, files: Files = () => ({})): Promise<Connected> {
  const fake = await underTest.serve();
  onTestFinished(fake.close);
  const connections = fakeConnections();
  connections.connect('acme', { id: behaviourConnection, name: 'graph', entry: fake.entry, environment });
  const reporting = await describedAccess(files(fake), { environment, timing, connections });
  onTestFinished(reporting.access.close);
  return { ...reporting, fake, connections };
}

function addedBeside({ connections, fake }: Connected, name: string, id: string): void {
  connections.connect('acme', { id, name, entry: fake.entry, environment });
}

function opened(access: ToolAccess, server: string) {
  return Effect.runPromise(Effect.flip(access.open(toolRun(recordingCallJournal()), [{ server, tool: 'search' }])));
}

async function echoedThrough(access: ToolAccess, input: Readonly<Record<string, unknown>>) {
  const journal = recordingCallJournal();
  const tools = await Effect.runPromise(access.open(toolRun(journal), [{ server: 'graph', tool: 'echo' }]));
  onTestFinished(tools.close);
  const [echo] = tools.offered;
  const reply = await echo?.call({ callId: 'call-1', input }, controlledSignals());
  return { reply, journal };
}

function oneCallOf(server: string) {
  return { ...alpha, reference: { server, tool: 'search' }, input: { query: 'acme' }, meta: {} };
}

function listed(access: ToolAccess) {
  return Effect.runPromise(access.listServers(alpha));
}

function namedAs(access: ToolAccess, server: string) {
  return Effect.runPromise(Effect.result(access.named(alpha, [{ server, tool: 'search' }])));
}

function unready(connected: Connected): void {
  connected.connections.pend('acme', { id: 'crm-id', name: 'crm', entry: connected.fake.entry, environment });
  addedBeside(connected, 'wiki', 'wiki-id');
  connected.connections.breakOff('wiki-id', brokenWords);
  addedBeside(connected, 'notes', 'notes-id');
  connected.connections.disallow('notes-id', ruleWords);
}

const refusals = [
  { server: 'crm', because: 'connection_pending', detail: pendingWords('crm') },
  { server: 'notes', because: 'connection_not_allowed', detail: ruleWords },
  { server: 'wiki', because: 'connection_broken', detail: brokenWords },
] as const;

async function refusedEachWay(access: ToolAccess, server: string) {
  return [
    await opened(access, server),
    await namedAs(access, server),
    await Effect.runPromise(access.callOnce(oneCallOf(server))),
  ];
}

function listing(underTest: ServerUnderTest): void {
  it('lists a connection by its name and id with its tools, and one that is not ready unavailable in its words', async () => {
    const connected = await connectedTo(underTest);
    unready(connected);

    expect(await listed(connected.access)).toMatchObject([
      { name: 'crm', connection: 'crm-id', because: 'connection_pending', unavailable: pendingWords('crm') },
      { name: 'graph', connection: behaviourConnection, playbooks: ['*'], tools: listedTools },
      { name: 'notes', connection: 'notes-id', because: 'connection_not_allowed', unavailable: ruleWords },
      { name: 'wiki', connection: 'wiki-id', because: 'connection_broken', unavailable: brokenWords },
    ]);
    expect(connected.connections.credentialReads()).toBe(2);
  });
}

function opening(underTest: ServerUnderTest): void {
  it('opens the tools of a connection for every run, reading its credential once for its link', async () => {
    const { access, connections, fake } = await connectedTo(underTest);

    const first = await echoedThrough(access, fake.echoed({ said: 'hello' }));
    await echoedThrough(access, fake.echoed({ said: 'again' }));

    expect(first.reply).toMatchObject({ isError: false, outcome: 'result' });
    expect([connections.credentialReads(), fake.calls()]).toEqual([1, 2]);
  });
}

function refusing(underTest: ServerUnderTest): void {
  it('refuses a run, a check of names and one call that name a connection not ready, in its words, and sends nothing', async () => {
    const connected = await connectedTo(underTest);
    unready(connected);

    const refused = await Promise.all(refusals.map(({ server }) => refusedEachWay(connected.access, server)));

    expect(refused).toMatchObject(
      refusals.map(({ because, detail }) => [
        { _tag: 'tool_not_offered', because, detail },
        { failure: { because, detail } },
        { kind: 'unopened', refused: 'tool_not_offered', because, detail },
      ]),
    );
    expect(connected.fake.requests()).toBe(0);
  });

  it('names a connection that is connected with no request to its server', async () => {
    const { access, connections, fake } = await connectedTo(underTest);

    expect(await namedAs(access, 'graph')).toMatchObject({ _tag: 'Success' });
    expect([fake.requests(), connections.credentialReads()]).toEqual([0, 1]);
  });
}

function recording(underTest: ServerUnderTest): void {
  it("records the start of one call with the connection's id beside the server's name", async () => {
    const { access } = await connectedTo(underTest);
    const journal = recordingCallJournal();

    const once = await Effect.runPromise(access.callOnce(oneCallOf('graph'), { callId: 'call-1', journal }));

    expect(once).toMatchObject({ kind: 'answered', outcome: 'result' });
    expect(journal.facts()[0]).toMatchObject({
      type: 'tool_call_started',
      data: { call_id: 'call-1', server: 'graph', connection_id: behaviourConnection, tool: 'search' },
    });
  });
}

function removal(underTest: ServerUnderTest): void {
  it('stops the link of a connection removed meanwhile at the next listing, and refuses a call through it', async () => {
    const { access, connections, fake } = await connectedTo(underTest);
    await echoedThrough(access, fake.echoed({}));

    connections.remove(behaviourConnection);

    expect(await listed(access)).toEqual([]);
    await until(() => fake.sessionsOpen() === 0);
    expect(await Effect.runPromise(access.callOnce(oneCallOf('graph')))).toMatchObject({
      because: 'tool_server_not_configured',
    });
  });

  it('takes a name a new connection reused with a link of its own, reading its own credential', async () => {
    const connected = await connectedTo(underTest);
    await listed(connected.access);

    connected.connections.remove(behaviourConnection);
    addedBeside(connected, 'graph', reused);
    const { journal } = await echoedThrough(connected.access, connected.fake.echoed({}));

    expect(await listed(connected.access)).toMatchObject([{ name: 'graph', connection: reused }]);
    expect(journal.facts()[0]).toMatchObject({ data: { connection_id: reused } });
    expect(connected.connections.credentialReads()).toBe(2);
  });
}

function shadowing(underTest: ServerUnderTest): void {
  it("resolves a name to the configuration's entry first, and lists the connection of that name as not used", async () => {
    const { access, fake } = await connectedTo(underTest, (served) => ({ graph: served.entry }));

    const { journal } = await echoedThrough(access, fake.echoed({}));

    expect(await listed(access)).toMatchObject([
      { name: 'graph', tools: listedTools },
      { name: 'graph', connection: behaviourConnection, because: 'connection_not_allowed', unavailable: takenWords },
    ]);
    expect(journal.facts()[0]?.data).not.toHaveProperty('connection_id');
  });
}

const lackingScope = { 'www-authenticate': 'Bearer error="insufficient_scope", scope="notes.write"' };

async function failedOnceWith(connected: Connected, status: number, headers?: Readonly<Record<string, string>>) {
  connected.fake.failNextCall(status, headers);
  const { reply } = await echoedThrough(connected.access, connected.fake.echoed({}));
  return reply?.text;
}

const scopeLacking =
  'The tool server graph failed: The tool server answered HTTP 403: the credential lacks the scope notes.write this request needs; a credential granted that scope would allow it';

function refusingTheCredential(underTest: ServerUnderTest): void {
  it('tells its source of a call its server answered 401 alone, and the call fails in the words the source recorded', async () => {
    const connected = await connectedTo(underTest);

    const otherwise = [
      await failedOnceWith(connected, 500),
      await failedOnceWith(connected, 429),
      await failedOnceWith(connected, 403, lackingScope),
    ];
    const told = connected.connections.refusalsTold();
    const refused = await failedOnceWith(connected, 401);

    expect([otherwise[2], told]).toEqual([scopeLacking, []]);
    expect(refused).toBe(`The tool server graph failed: ${refusedWords('graph')}`);
    expect(connected.connections.refusalsTold()).toEqual([behaviourConnection]);
    expect(await listed(connected.access)).toMatchObject([
      { because: 'connection_broken', unavailable: refusedWords('graph') },
    ]);
  });
}

function breaking(underTest: ServerUnderTest): void {
  it('refuses a connection whose credential cannot be read once its link is made, and lists it broken from then on', async () => {
    const { access, connections } = await connectedTo(underTest);
    connections.loseTheCredentialOf(behaviourConnection, brokenWords);

    expect(await opened(access, 'graph')).toMatchObject({ because: 'connection_broken', detail: brokenWords });
    expect(await listed(access)).toMatchObject([{ because: 'connection_broken', unavailable: brokenWords }]);
  });
}

export function connectionBehaviour(underTest: ServerUnderTest): void {
  describe(`the tools of ${underTest.kind} a person added as a connection`, () => {
    listing(underTest);
    opening(underTest);
    refusing(underTest);
    recording(underTest);
    removal(underTest);
    shadowing(underTest);
    refusingTheCredential(underTest);
    breaking(underTest);
  });
}
