import { Predicate } from 'effect';
import { describe, expect, it } from 'vitest';

import { describingGateway } from '../provider-testing/answers-in-turn.ts';
import {
  anthropicMessage,
  chatCompletion,
  converseMessage,
  openAiResponse,
} from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import { geminiFunctionCall } from '../provider-testing/tool-call-replies.ts';
import type { Environment } from '../settings/setting-values.ts';
import { accessFor, jsonRequest, succeeded } from '../testing/adapter-harness.ts';

const tools = [{ name: 'lookup', description: 'Looks an account up', inputSchema: { type: 'object' } }];

const conversation = [
  {
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'lookup', input: { account: 'acme' } }],
  },
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'lookup',
        output: { type: 'json', value: { rows: 2 } },
      },
    ],
  },
];

const aws = () => Promise.resolve({ accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' });

interface Provider {
  readonly environment: Environment;
  readonly model: string;
  readonly reply: (verdict: unknown) => object;
  readonly turns: string;
  readonly toolUse: string;
  readonly toolResult: string;
}

const providers: readonly (readonly [string, Provider])[] = [
  [
    'anthropic',
    {
      environment: { ANTHROPIC_API_KEY: 'k' },
      model: 'anthropic/claude-sonnet-4-5',
      reply: (verdict) => anthropicMessage(JSON.stringify({ verdict })),
      turns: 'messages',
      toolUse: '"type":"tool_use"',
      toolResult: '"type":"tool_result"',
    },
  ],
  [
    'bedrock',
    {
      environment: { AWS_REGION: 'us-east-1' },
      model: 'bedrock/eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
      reply: (verdict) => converseMessage(JSON.stringify({ verdict })),
      turns: 'messages',
      toolUse: '"toolUse"',
      toolResult: '"toolResult"',
    },
  ],
  [
    'google',
    {
      environment: { GOOGLE_GENERATIVE_AI_API_KEY: 'g-key' },
      model: 'google/gemini-2.5-flash',
      reply: (verdict) => geminiFunctionCall('json', { verdict }),
      turns: 'contents',
      toolUse: '"functionCall"',
      toolResult: '"functionResponse"',
    },
  ],
  [
    'openai',
    {
      environment: { OPENAI_API_KEY: 'k' },
      model: 'openai/gpt-5',
      reply: (verdict) => openAiResponse(JSON.stringify({ verdict })),
      turns: 'input',
      toolUse: '"type":"function_call"',
      toolResult: '"type":"function_call_output"',
    },
  ],
  [
    'a gateway',
    {
      environment: describingGateway,
      model: 'internal/llama-3.3-70b',
      reply: (verdict) => chatCompletion(JSON.stringify({ verdict })),
      turns: 'messages',
      toolUse: '"tool_calls"',
      toolResult: '"role":"tool"',
    },
  ],
];

function besideThe(turns: string, body: unknown): string {
  const fields = Predicate.isObject(body) ? Object.entries(body) : [];
  return JSON.stringify(fields.filter(([field]: readonly [string, unknown]) => field !== turns));
}

function wrongThenRight(reply: Provider['reply']) {
  const replies = [reply(42), reply('approve')];
  return recordingFetch((_request, attempt) => jsonResponse(replies[attempt - 1]));
}

describe('a JSON answer that misses its schema after a tool was called', () => {
  it.each(providers)(
    'is asked of %s in the first request with only the answer and its issues added, the tools and their calls kept',
    async (_provider, { environment, model, reply, turns, toolUse, toolResult }) => {
      const recording = wrongThenRight(reply);
      const access = await accessFor(environment, { fetch: recording.fetch, credentials: { aws } });

      const result = await succeeded(access, jsonRequest(model, { tools, conversation }));

      const [first, second] = recording.requests().map(({ body }) => body);
      const sent = JSON.stringify(second);
      expect(result).toMatchObject({ json: { verdict: 'approve' }, repair: { outcome: 'repaired' } });
      expect(besideThe(turns, second)).toBe(besideThe(turns, first));
      expect([sent.includes(toolUse), sent.includes(toolResult)]).toEqual([true, true]);
      expect(sent).toContain('/verdict: Expected string');
      expect(result.warnings).toEqual([]);
    },
  );
});
