import { loadedMessage } from '@on.auto/access-control';
import { undecidedMessage } from '@on.auto/operations';
import { type ShippedFile, shippedFileIn, type ShippedFiles } from '@on.auto/shipped-files';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { defaultTiming, type ToolAccess, ToolServerDocumentRefused } from '@on.auto/tool-servers';
import { gatewayDocumentOf } from '@on.auto/tool-servers/served-fakes';
import { noToolServers } from '@on.auto/tool-servers/testing';
import { Cause, Effect, Layer, ManagedRuntime, Schema } from 'effect';
import { afterAll, describe, expect, it, onTestFinished } from 'vitest';

import { shippedRoots } from '../server-options/shipped-roots.ts';
import { personSigningIn } from '../sign-in/person-signing-in.ts';
import { logLinesOf, requestTo, workflowProcess } from '../testing/processes/workflow-process.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { contributing, givenGoals, workflowSource } from '../testing/servers/workflow-server.ts';
import { whenHeld } from '../testing/waiting/until.ts';
import { computationServedBy, type ProgramPoolOf, type ServedComputation, workerPool } from './served-computation.ts';
import { connectionWaysOf, toolAccessOf } from './served-tool-access.ts';

const ledger = temporaryLedger();

const closing = workflowSource(
  'close-the-month',
  'schedule:\n  on: { one: { with: { type: com.acme.ledger.closed } } }\ndo:\n  - total: { set: { closed: true } }\n',
);

const runsOf = Schema.decodeUnknownSync(Schema.Struct({ runs: Schema.Array(Schema.Unknown) }));

interface Closing {
  readonly closed: readonly string[];
  readonly closes: (what: string) => void;
  readonly served: () => Promise<ServedComputation>;
}

function closingRecorded(): Closing {
  const closed: string[] = [];
  const closes = (what: string) => {
    closed.push(what);
  };
  const poolOf: ProgramPoolOf = (settings, handed) => {
    const pool = workerPool(settings, handed);
    return {
      ...pool,
      close: async () => {
        closes('pool');
        await pool.close();
      },
    };
  };
  return {
    closed,
    closes,
    served: () => computationServedBy({ workers: 1 }, poolOf, shippedFilesOnDisk(shippedRoots)),
  };
}

const entries: ShippedFile = { package: '@on.auto/providers', path: 'src/entries' };

const gateway = 'https://gateway.messages.example.com';

const entry = [
  'name: messages',
  'title: Messages',
  'description: Read and post the messages of a workspace, as the app added to it.',
  'website: https://developer.messages.example.com',
  'type: openapi',
  'document: documents/messages.openapi.json',
  'credentials:',
  '  - kind: authorization',
  '    issuer: https://messages.example.com',
  '    gateway:',
  `      url: ${gateway}/connections`,
  '      audiences:',
  `        connections: ${gateway}`,
  `        calls: ${gateway}/api`,
  '    in: security',
  '    name: connection_key',
  '    description: Add the app to your workspace.',
  '',
].join('\n');

const shippedBeside: ReadonlyMap<string, string> = new Map([
  [shippedFileIn(entries, 'messages.yaml').path, entry],
  [
    shippedFileIn(entries, 'documents/messages.openapi.json').path,
    JSON.stringify(gatewayDocumentOf(gateway, 'Connection-Key')),
  ],
]);

function shippedBesideAt(file: ShippedFile): string | undefined {
  return file.package === entries.package ? shippedBeside.get(file.path) : undefined;
}

function isTheEntries(folder: ShippedFile): boolean {
  return folder.package === entries.package && folder.path === entries.path;
}

function shippedWithAnEntryThroughAGateway(files: ShippedFiles): ShippedFiles {
  return {
    text: (file) => {
      const text = shippedBesideAt(file);
      return text === undefined ? files.text(file) : Promise.resolve(text);
    },
    bytes: (file) => {
      const text = shippedBesideAt(file);
      return text === undefined ? files.bytes(file) : Promise.resolve(new TextEncoder().encode(text));
    },
    list: async (folder) =>
      isTheEntries(folder) ? [...(await files.list(folder)), 'messages.yaml'] : files.list(folder),
  };
}

const builtInPolicies: ShippedFile = { package: '@on.auto/access-control', path: 'src/policies/built-in.cedar' };

function isTheBuiltInPolicies(file: ShippedFile): boolean {
  return file.package === builtInPolicies.package && file.path === builtInPolicies.path;
}

function shippedWithPoliciesThatDoNotParse(files: ShippedFiles): ShippedFiles {
  return {
    ...files,
    text: (file) => (isTheBuiltInPolicies(file) ? Promise.resolve('permit (') : files.text(file)),
  };
}

const notHere =
  "The provider messages connects through a service that Auto's cloud runs, which this runtime does not have";

const ListedSchema = Schema.Struct({
  providers: Schema.Array(Schema.Struct({ name: Schema.String, credentials: Schema.Array(Schema.Unknown) })),
});

interface Asking {
  readonly org: string;
  readonly token?: string;
}

async function servedWith(environment: Readonly<Record<string, string>>): Promise<ReasoningServer> {
  const server = await servingReasoning([], environment, undefined, {
    shippedFilesOver: shippedWithAnEntryThroughAGateway,
  });
  onTestFinished(server.stop);
  return server;
}

async function answeredFor(server: ReasoningServer, { org, token }: Asking) {
  const bearing = token === undefined ? {} : { key: token };
  const listed = await server.call('GET', `/v1/orgs/${org}/providers`, bearing);
  const added = await server.call('POST', `/v1/orgs/${org}/connections`, {
    ...bearing,
    body: { provider: 'messages' },
  });
  const kept = await server.call('GET', `/v1/orgs/${org}/connections`, bearing);
  const { providers } = Schema.decodeUnknownSync(ListedSchema)(listed.body);
  return {
    ways: providers.find(({ name }) => name === 'messages')?.credentials,
    added: { status: added.status, body: added.body },
    kept: kept.body,
  };
}

const refusedThroughAGateway = {
  ways: [{ kind: 'authorization', in: 'security', name: 'connection_key', offered: false, because: notHere }],
  added: { status: 422, body: { reason: 'invalid_input', errors: [{ pointer: '/provider', detail: notHere }] } },
  kept: { connections: [] },
};

const mebibyte = 1_048_576;

const noServers = {
  toolServers: { servers: [], referencedVariables: [] },
  toolCalls: { mostRequestBytes: 16 * mebibyte },
};

const scope = { org: 'acme', playbook: 'alpha' };

function countedComposing(): { readonly asked: () => number; readonly composing: Effect.Effect<ToolAccess> } {
  const counts = { asked: 0 };
  return {
    asked: () => counts.asked,
    composing: Effect.sync(() => {
      counts.asked += 1;
      return noToolServers;
    }),
  };
}

describe('served access control', () => {
  afterAll(() => {
    ledger.remove();
  });

  describe('the server', () => {
    it('loads the policy decision point at start, once, over every operation served, and lets each call it decides through', async () => {
      const child = workflowProcess(ledger.fileName);
      const port = await child.port;
      const atStart = logLinesOf(child).filter(({ message }) => message === loadedMessage);

      const created = await requestTo(port, 'POST', '', { playbook: 'gamma', name: 'Gamma', goals: givenGoals });
      const listed = await requestTo(port, 'GET', '');
      const read = await requestTo(port, 'GET', '/gamma');
      child.signal('SIGTERM');
      await child.exited;
      const lines = logLinesOf(child);

      expect([created.status, listed.status, read.status]).toEqual([201, 200, 200]);
      expect(atStart).toMatchObject([{ level: 'INFO', annotations: { engine: 'Cedar 4.14.0', policies: 13 } }]);
      expect(atStart[0]?.annotations['operations']).toBeGreaterThan(60);
      expect(lines.filter(({ message }) => message === loadedMessage)).toHaveLength(1);
      expect(lines.filter(({ message }) => message === undecidedMessage)).toEqual([]);
    });

    it('refuses to start, as it refuses a setting it cannot use, where the access policies it ships cannot be used', async () => {
      const refused: unknown = await servingReasoning([], {}, undefined, {
        shippedFilesOver: shippedWithPoliciesThatDoNotParse,
      }).catch((failure: unknown) => failure);

      expect(refused).toMatchObject({ _tag: 'UnusableAccessPoliciesError' });
    });

    it('lets through the start of a run an event triggers, which the workflow host asks of the playbook as itself', async () => {
      const child = workflowProcess(ledger.fileName);
      const port = await child.port;

      await requestTo(port, 'POST', '', { playbook: 'delta', name: 'Delta', goals: givenGoals });
      await requestTo(port, 'POST', '/delta/definitions/workflow', {
        name: 'close-the-month',
        source: contributing(closing),
      });
      await requestTo(port, 'POST', '/delta/events', {
        event: { source: '/ledger', type: 'com.acme.ledger.closed', data: { month: 'october' } },
      });
      const started = await whenHeld(
        () => requestTo(port, 'GET', '/delta/runs?type=workflow&name=close-the-month'),
        ({ body }) => runsOf(body).runs.length > 0,
      );
      child.signal('SIGTERM');
      await child.exited;

      expect(runsOf(started.body).runs).toHaveLength(1);
      expect(logLinesOf(child).filter(({ message }) => message === undecidedMessage)).toEqual([]);
    });
  });
});

describe('the pool of workers of a server', () => {
  it('closes after every other service as the runtime is disposed', async () => {
    const { closed, closes, served } = closingRecorded();
    const computation = await served();
    const services = Layer.effectDiscard(
      Effect.addFinalizer(() =>
        Effect.sync(() => {
          closes('services');
        }),
      ),
    );
    const runtime = ManagedRuntime.make(computation.closedLastOf(services));

    await runtime.runPromise(Effect.void);
    await runtime.dispose();

    expect(closed).toEqual(['services', 'pool']);
  });

  it('closes when the services fail to start, and when what is made with it is refused', async () => {
    const { closed, served } = closingRecorded();
    const failed = await served();
    const runtime = ManagedRuntime.make(failed.closedLastOf(Layer.effectDiscard(Effect.die('The ledger is refused'))));
    const refused = await served();

    await expect(runtime.runPromise(Effect.void)).rejects.toThrow('The ledger is refused');
    await expect(
      refused.closedIfRefused(() => {
        throw new Error('The extension is refused');
      }),
    ).rejects.toThrow('The extension is refused');
    expect(closed).toEqual(['pool', 'pool']);
  });
});

describe('a provider whose shipped entry connects through a gateway, on the server a self-hosted or local runtime runs', () => {
  it('is listed as not offered, saying why, and its addition is refused at /provider with nothing recorded, by a server answering the local developer and one that signs people in alike', async () => {
    const signing = await personSigningIn();
    const local = await servedWith({});
    const signingIn = await servedWith(signing.environment);
    const person = await signing.tokenAt(signingIn.origin, 'Ada');

    const answered = [
      await answeredFor(local, { org: 'local' }),
      await answeredFor(signingIn, { org: 'default', token: person }),
    ];

    expect(answered).toMatchObject([refusedThroughAGateway, refusedThroughAGateway]);
  });
});

describe('the tool access a server makes at start', () => {
  it('asks for the composed access only when one of its ways is used, and closes nothing of it', async () => {
    const { asked, composing } = countedComposing();
    const tools = toolAccessOf(composing, noServers, { takesConnections: false });
    const beforeUse = asked();

    const listed = await Effect.runPromise(tools.listServers(scope));
    await tools.close();

    expect({ beforeUse, listed, afterUse: asked() }).toEqual({ beforeUse: 0, listed: [], afterUse: 1 });
  });

  it('says it is configured as the composed access will, from the servers it names and the connections it takes', () => {
    const { composing } = countedComposing();

    expect(
      [
        toolAccessOf(composing, noServers, { takesConnections: false }),
        toolAccessOf(composing, noServers, { takesConnections: true }),
      ].map(({ configured, takesConnections }) => ({ configured, takesConnections })),
    ).toEqual([
      { configured: false, takesConnections: false },
      { configured: true, takesConnections: true },
    ]);
  });

  it('bounds a call as its timing does, the default unless one is given, without composing anything', () => {
    const { asked, composing } = countedComposing();

    expect([
      toolAccessOf(composing, noServers, { takesConnections: false }).callMs,
      toolAccessOf(composing, noServers, { takesConnections: false }, { ...defaultTiming, callMs: 5000 }).callMs,
      asked(),
    ]).toEqual([defaultTiming.callMs, 5000, 0]);
  });

  it('calls as a connection through the composed access only when asked to', async () => {
    const counts = { asked: 0 };
    const ways = connectionWaysOf(
      Effect.sync(() => {
        counts.asked += 1;
        return { callAsTheConnection: () => Effect.undefined };
      }),
    );
    const beforeUse = counts.asked;

    const called = await Effect.runPromise(
      ways.callAsTheConnection({ org: 'acme', connection: 'connection-1', tool: 'echo', input: {} }),
    );

    expect([beforeUse, called, counts.asked]).toEqual([0, undefined, 1]);
  });

  it('fails a way used with the refusal of a composition that fails, as a defect', async () => {
    const refusal = new ToolServerDocumentRefused({
      message: 'The documents of the tool servers could not be read.',
      problems: [],
    });
    const tools = toolAccessOf(Effect.fail(refusal), noServers, { takesConnections: false });

    const cause = await Effect.runPromise(Effect.flip(Effect.sandbox(tools.listServers(scope))));

    expect([Cause.hasDies(cause), Cause.squash(cause)]).toEqual([true, refusal]);
  });
});

describe('the most a call through the access a server makes may send', () => {
  it('bounds the request of a call to any server by the setting it is given, without composing anything', () => {
    const { asked, composing } = countedComposing();
    const tools = toolAccessOf(
      composing,
      { ...noServers, toolCalls: { mostRequestBytes: 32 * mebibyte } },
      {
        takesConnections: true,
      },
    );

    expect([tools.mostRequestBytes, tools.mostRequestBytesTo('graph'), asked()]).toEqual([
      32 * mebibyte,
      32 * mebibyte,
      0,
    ]);
  });
});
