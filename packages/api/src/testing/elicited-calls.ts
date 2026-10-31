import { Client, StreamableHTTPClientTransport, type ClientCapabilities } from '@modelcontextprotocol/client';
import { Effect, Schema } from 'effect';

import { toolResultOf, type McpConnection, type ToolResult } from './mcp-clients.ts';

interface ToolCall {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface LinkOpening {
  readonly opens: 'links' | 'forms alone';
  readonly revision: 'current revision' | 'previous revision';
  readonly action: 'accept' | 'decline' | 'cancel';
  readonly onThePage?: (url: string) => Promise<unknown>;
}

export interface LinksAsked {
  readonly answer: ToolResult;
  readonly elicited: readonly unknown[];
}

const openingEveryLink: LinkOpening = { opens: 'links', revision: 'current revision', action: 'accept' };

const ElicitationSchema = Schema.Struct({ params: Schema.Unknown });

const LinkAskedSchema = Schema.Struct({ url: Schema.String });

function negotiatedIn(revision: LinkOpening['revision']) {
  return { mode: revision === 'current revision' ? { pin: '2026-07-28' } : 'legacy' } as const;
}

async function answeredBy(made: () => Client, { url, headers }: McpConnection, call: ToolCall): Promise<ToolResult> {
  const client = made();
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { ...headers } } }));
  try {
    return toolResultOf(await client.callTool({ name: call.name, arguments: { ...call.arguments } }));
  } finally {
    await client.close();
  }
}

export async function calledOpeningLinks(
  connection: McpConnection,
  call: ToolCall,
  opening: Partial<LinkOpening> = {},
): Promise<LinksAsked> {
  const { opens, revision, action, onThePage } = { ...openingEveryLink, ...opening };
  const elicited: unknown[] = [];
  const capabilities = { elicitation: opens === 'links' ? { url: {} } : { form: {} } };
  const made = () => {
    const client = new Client(
      { name: 'auto-runtime-tests', version: '2.0.0' },
      { capabilities, versionNegotiation: negotiatedIn(revision) },
    );
    client.setRequestHandler('elicitation/create', async (request: unknown) => {
      const { params } = Schema.decodeUnknownSync(ElicitationSchema)(request);
      elicited.push(params);
      await onThePage?.(Schema.decodeUnknownSync(LinkAskedSchema)(params).url);
      return { action };
    });
    return client;
  };
  return { answer: await answeredBy(made, connection, call), elicited };
}

export interface FormAnswering {
  readonly declares: 'forms' | 'no mode' | 'links alone' | 'no elicitation';
  readonly revision: 'current revision' | 'previous revision';
  readonly action: 'accept' | 'decline' | 'cancel';
  readonly content?: Readonly<Record<string, string>>;
}

const answeringEveryForm: FormAnswering = { declares: 'forms', revision: 'current revision', action: 'accept' };

const declaredBy: Readonly<Record<FormAnswering['declares'], ClientCapabilities>> = {
  forms: { elicitation: { form: {} } },
  'no mode': { elicitation: {} },
  'links alone': { elicitation: { url: {} } },
  'no elicitation': {},
};

export async function calledAnsweringForms(
  connection: McpConnection,
  call: ToolCall,
  answering: Partial<FormAnswering> = {},
): Promise<LinksAsked> {
  const { declares, revision, action, content } = { ...answeringEveryForm, ...answering };
  const elicited: unknown[] = [];
  const capabilities = declaredBy[declares];
  const made = () => {
    const client = new Client(
      { name: 'auto-runtime-tests', version: '2.0.0' },
      { capabilities, versionNegotiation: negotiatedIn(revision) },
    );
    if (declares !== 'no elicitation') {
      client.setRequestHandler('elicitation/create', (request: unknown) => {
        elicited.push(Schema.decodeUnknownSync(ElicitationSchema)(request).params);
        return Promise.resolve(content === undefined ? { action } : { action, content: { ...content } });
      });
    }
    return client;
  };
  return { answer: await answeredBy(made, connection, call), elicited };
}

const StateAskedSchema = Schema.Struct({
  data: Schema.Struct({ lastResult: Schema.Struct({ requestState: Schema.String }) }),
});

const stateAskedIn = Schema.decodeUnknownSync(StateAskedSchema);

async function linkOpenerOn({ url, headers }: McpConnection, rounds: number): Promise<Client> {
  const client = new Client(
    { name: 'auto-runtime-tests', version: '2.0.0' },
    {
      capabilities: { elicitation: { url: {} } },
      versionNegotiation: { mode: { pin: '2026-07-28' } },
      inputRequired: { maxRounds: rounds },
    },
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { ...headers } } }));
  return client;
}

export async function stateAskedBy(connection: McpConnection, call: ToolCall): Promise<string> {
  const client = await linkOpenerOn(connection, 0);
  const asking = Effect.tryPromise({
    try: () => client.callTool({ name: call.name, arguments: { ...call.arguments } }),
    catch: (stopped: unknown) => stopped,
  });
  const stopped = await Effect.runPromise(Effect.flip(asking));
  await client.close();
  return stateAskedIn(stopped).data.lastResult.requestState;
}

export async function retriedWith(
  connection: McpConnection,
  call: ToolCall,
  requestState: string,
): Promise<ToolResult> {
  const client = await linkOpenerOn(connection, 1);
  const retry = {
    name: call.name,
    arguments: { ...call.arguments },
    requestState,
    inputResponses: { link: { action: 'accept' } },
  };
  try {
    return toolResultOf(await client.callTool(retry));
  } finally {
    await client.close();
  }
}
