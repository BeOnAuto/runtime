import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { Schema } from 'effect';

import type { MeasuredLedger } from './measured-ledgers.ts';
import { measuredServer, playbook, type MeasuredServer } from './measured-server.ts';
import { appendCostOf, counting, inTurn, statsOf } from './run-appends.ts';

type Write = (line: string) => void;

interface Scenario {
  readonly name: string;
  readonly tools: boolean;
  readonly answer: (asked: Asked) => object;
}

interface Asked {
  readonly results: number;
  readonly offersTools: boolean;
  readonly tool: string;
}

const BlockSchema = Schema.Struct({ type: Schema.String });

const MessagesSchema = Schema.Struct({
  messages: Schema.Array(Schema.Struct({ content: Schema.Union([Schema.String, Schema.Array(BlockSchema)]) })),
  tools: Schema.optionalKey(Schema.Array(Schema.Struct({ name: Schema.String }))),
});

const decodeMessages = Schema.decodeUnknownSync(Schema.fromJsonString(MessagesSchema));

const RunSchema = Schema.Struct({
  status: Schema.Union([Schema.String, Schema.Number]),
  kind: Schema.optionalKey(Schema.String),
  because: Schema.optionalKey(Schema.String),
});

const decodeRun = Schema.decodeUnknownSync(RunSchema);

function askedOf(body: string): Asked {
  const { messages, tools } = decodeMessages(body);
  const results = messages
    .flatMap(({ content }) => (typeof content === 'string' ? [] : content))
    .filter(({ type }) => type === 'tool_result').length;
  const [offered] = tools ?? [];
  return { results, offersTools: offered !== undefined, tool: offered?.name ?? 'graph__search' };
}

function text(said: string): object {
  return {
    id: 'msg_measure_text',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5-20250929',
    content: [{ type: 'text', text: said }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 25, output_tokens: 9 },
  };
}

function searches(count: number, from: number, tool: string): object {
  return {
    id: 'msg_measure_calls',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5-20250929',
    content: Array.from({ length: count }, (_, index) => ({
      type: 'tool_use',
      id: `toolu_measure_${from + index + 1}`,
      name: tool,
      input: { query: `rows ${from + index + 1}` },
    })),
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 30, output_tokens: 12 },
  };
}

function callingUntil(results: number, inOneStep: number) {
  return ({ results: answered, offersTools, tool }: Asked): object =>
    offersTools && answered < results ? searches(inOneStep, answered, tool) : text('Read them.');
}

const scenarios: readonly Scenario[] = [
  { name: 'no tools', tools: false, answer: () => text('Answered.') },
  { name: 'one tool call', tools: true, answer: callingUntil(1, 1) },
  { name: 'three tool calls in one step', tools: true, answer: callingUntil(3, 3) },
  { name: 'five tool calls, one a step', tools: true, answer: callingUntil(5, 1) },
  { name: 'every call a run may make, then the final step', tools: true, answer: callingUntil(25, 25) },
  {
    name: 'a final step that still calls tools',
    tools: true,
    answer: ({ results, offersTools, tool }) =>
      offersTools && results < 25 ? searches(25, results, tool) : searches(1, 25, tool),
  },
];

const listedModels = {
  data: [
    {
      id: 'claude-sonnet-4-5',
      type: 'model',
      display_name: 'Claude Sonnet 4.5',
      created_at: '2025-09-29T00:00:00Z',
      max_input_tokens: 200_000,
      max_tokens: 64_000,
    },
  ],
  has_more: false,
};

interface FakeProvider {
  readonly url: string;
  readonly requests: () => number;
  readonly playing: (scenario: Scenario) => void;
  readonly close: () => Promise<void>;
}

const portOf = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

async function bodyOf(request: IncomingMessage): Promise<string> {
  request.setEncoding('utf8');
  let body = '';
  for await (const part of request) {
    body += String(part);
  }
  return body;
}

async function fakeProvider(): Promise<FakeProvider> {
  const state = { requests: 0, scenario: scenarios[0] };
  const answering = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const body = await bodyOf(request);
    response.writeHead(200, { 'content-type': 'application/json' });
    if (request.method !== 'POST') {
      response.end(JSON.stringify(listedModels));
      return;
    }
    state.requests += 1;
    response.end(JSON.stringify(state.scenario?.answer(askedOf(body)) ?? text('Answered.')));
  };
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  server.on('request', (request: IncomingMessage, response: ServerResponse) => {
    void answering(request, response);
  });
  return {
    url: `http://127.0.0.1:${portOf(server.address()).port}/v1`,
    requests: () => state.requests,
    playing: (scenario) => {
      state.scenario = scenario;
    },
    close: async () => {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}

const withTools = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [graph/search]', '---', 'Read the rows.'];

const withoutTools = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Answer.'];

const keepingNothing = withTools.map((line) => line.replace('graph/search', 'quiet/search'));

async function defined(server: MeasuredServer): Promise<void> {
  await server.call('POST', '/v1/orgs/local/playbooks', { playbook: 'measure', name: 'Measure' });
  await server.call('POST', `${playbook}/definitions/reasoning`, { name: 'reading', source: withTools.join('\n') });
  await server.call('POST', `${playbook}/definitions/reasoning`, {
    name: 'answering',
    source: withoutTools.join('\n'),
  });
  await server.call('POST', `${playbook}/definitions/reasoning`, {
    name: 'quietly',
    source: keepingNothing.join('\n'),
  });
}

async function ran(server: MeasuredServer, scenario: Scenario, keeping = true): Promise<string> {
  const reading = keeping ? 'reading' : 'quietly';
  const name = scenario.tools ? reading : 'answering';
  const run = decodeRun(await server.call('POST', `${playbook}/definitions/reasoning/${name}/run`, { input: {} }));
  return typeof run.status === 'string' ? run.status : `rejected as ${run.kind ?? 'no kind'}, ${run.because ?? ''}`;
}

function modelCallsOf(server: MeasuredServer, provider: FakeProvider, write: Write): Promise<void> {
  return inTurn(scenarios, async (scenario) => {
    provider.playing(scenario);
    const before = provider.requests();
    const status = await ran(server, scenario);
    write(`  ${scenario.name}: ${provider.requests() - before} model calls, ${status}`);
  });
}

interface Timed {
  readonly scenario: string;
  readonly runs: number;
  readonly keeping: boolean;
}

async function wallTimesOf(server: MeasuredServer, provider: FakeProvider, timed: Timed, write: Write) {
  const scenario = scenarios.find(({ name }) => name === timed.scenario);
  if (scenario === undefined) {
    return;
  }
  provider.playing(scenario);
  await ran(server, scenario, timed.keeping);
  const times: number[] = [];
  await inTurn(counting(timed.runs), async () => {
    const started = performance.now();
    await ran(server, scenario, timed.keeping);
    times.push(performance.now() - started);
  });
  const kept = timed.keeping ? 'keeping its content' : 'keeping no content';
  write(`  a run of ${scenario.name}, ${kept}, over ${timed.runs} runs: ${statsOf(times)}`);
}

const timedRuns: readonly Timed[] = [
  { scenario: 'no tools', runs: 30, keeping: true },
  { scenario: 'five tool calls, one a step', runs: 30, keeping: true },
  { scenario: 'five tool calls, one a step', runs: 30, keeping: false },
  { scenario: 'every call a run may make, then the final step', runs: 30, keeping: true },
];

export async function reasoningStepsOn(ledger: MeasuredLedger, write: Write): Promise<void> {
  const provider = await fakeProvider();
  const graph = await serveFakeMcp();
  const use = await ledger.aLedger();
  const server = await measuredServer({
    ...use.environment,
    ANTHROPIC_API_KEY: 'measure-key',
    ANTHROPIC_BASE_URL: provider.url,
    TOOL_SERVERS: JSON.stringify({
      graph: { url: graph.url, org: 'local' },
      quiet: { url: graph.url, org: 'local', record_content: false },
    }),
  });
  try {
    write(`${ledger.store}: reasoning runs, their model calls and their time`);
    await defined(server);
    await modelCallsOf(server, provider, write);
    await inTurn(timedRuns, (timed) => wallTimesOf(server, provider, timed, write));
  } finally {
    await server.stop();
    await graph.close();
    await provider.close();
  }
  const ledgerFile = use.environment['LEDGER_FILE'];
  if (ledgerFile !== undefined) {
    await appendCostOf(ledgerFile, 200, write);
  }
}
