import { Schema } from 'effect';

import { alpha, type ReasoningServer } from '../servers/reasoning-server.ts';
import { tallyCreated } from '../servers/tally-server.ts';
import { workflowSource } from '../servers/workflow-server.ts';
import { until } from '../waiting/until.ts';

const summary = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Summarize acme.'].join('\n');

const askingThenTallying = workflowSource(
  'asking-then-tallying',
  `do:
  - ask: { call: run_definition, with: { type: reasoning, name: summary, input: {} } }
  - tally: { call: run_definition, with: { type: workflow, name: tally } }
`,
);

const nestingIt = workflowSource(
  'nesting-it',
  'do:\n  - nest: { call: run_definition, with: { type: workflow, name: asking-then-tallying } }\n',
);

const HistorySchema = Schema.Struct({
  events: Schema.Array(Schema.Struct({ type: Schema.String, summary: Schema.String, data: Schema.Json })),
});

const decodeHistory = Schema.decodeUnknownSync(HistorySchema);

const WaitSchema = Schema.Struct({
  waits_for: Schema.Literal('admission'),
  times: Schema.Number,
  detail: Schema.String,
  retry_at: Schema.String,
  until: Schema.String,
});

const isWait = Schema.is(WaitSchema);

export interface Wait {
  readonly summary: string;
  readonly data: typeof WaitSchema.Type;
}

export async function waitsOf(server: ReasoningServer, run: string): Promise<readonly Wait[]> {
  const history = await server.call('GET', `${alpha}/runs/${run}/history?limit=100`);
  return decodeHistory(history.body).events.flatMap(({ type, summary: said, data }) =>
    type === 'step_waiting' && isWait(data) ? [{ summary: said, data }] : [],
  );
}

export function waitingAgain(server: ReasoningServer, run: string, times: number): Promise<readonly Wait[]> {
  return until(
    () => waitsOf(server, run),
    (waits) => waits.length === times,
  );
}

export async function defined(server: ReasoningServer): Promise<void> {
  await tallyCreated(server);
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });
  await server.call('POST', `${alpha}/definitions/workflow`, {
    body: { name: 'asking-then-tallying', source: askingThenTallying },
  });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'nesting-it', source: nestingIt } });
}

export async function untilItsModelWasAsked(server: ReasoningServer): Promise<void> {
  await until(
    () => server.modelCalls(),
    (calls) => calls === 1,
  );
}
