import type { CallFact, RunAttempt } from '@on.auto/definitions';
import { cancelledAfter, recordingJournal, type RecordingJournal } from '@on.auto/definitions/testing';
import type { RecordedContent } from '@on.auto/operations';
import { memoryRecordedContent } from '@on.auto/operations/testing';
import { Effect } from 'effect';

import type { ToolCallAnswer, ToolCallJob } from '../jobs/jobs.ts';
import { performedInProcess } from '../jobs/performed-in-process.ts';
import { keptIn, type KeptContent } from '../steps/kept-content.ts';
import { answeredByTheSteps } from '../steps/run-steps.ts';
import { scriptedLanguageModel, type ScriptedLanguageModel, type ScriptedReply } from './scripted-language-model.ts';

type SteppedRun = Parameters<typeof answeredByTheSteps>[0];

type StepTool = SteppedRun['tools']['offered'][number];

export const secretOfTheServers = 'graph-api-key-4f1d9a7c2b';

export const foundRows: ToolCallAnswer['reply'] = { text: 'Found 2 rows.', isError: false };

const utf8 = new TextEncoder();

export function answeredWith({ text, isError }: ToolCallAnswer['reply']): ToolCallAnswer {
  const data = { is_error: isError, result_bytes: utf8.encode(text).byteLength, duration_ms: 1, jsonrpc_id: 1 };
  return { ended: { type: 'tool_call_answered', data }, reply: { text, isError } };
}

function keptAnswerOf(kept: KeptContent | undefined): () => Effect.Effect<ToolCallAnswer> {
  const answer = answeredWith(foundRows);
  const result = JSON.stringify({ content: [{ type: 'text', text: foundRows.text }], isError: false });
  return () =>
    kept === undefined
      ? Effect.succeed(answer)
      : Effect.map(kept.keep(result), ({ sha256, bytes }) => ({
          ended: {
            type: 'tool_call_answered',
            data: { is_error: false, result_bytes: bytes, result_sha256: sha256, duration_ms: 1, jsonrpc_id: 1 },
          },
          reply: answer.reply,
        }));
}

export function toolOf(server: string, tool: string, readOnly = true): StepTool {
  return {
    name: `${server}__${tool}`,
    description: `Calls ${tool} of ${server}.`,
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    reference: { server, tool },
    readOnly,
    start: ({ callId, input }) =>
      Promise.resolve({
        call_id: callId,
        server,
        tool,
        arguments_bytes: utf8.encode(JSON.stringify(input)).byteLength,
        ...(readOnly ? { read_only: true as const } : {}),
      }),
  };
}

export const defaultBounds: SteppedRun['bounds'] = {
  runBoundMs: 600_000,
  limits: { contextWindow: undefined, mostInputTokens: 2_000_000 },
};

export interface StepsOptions {
  readonly replies?: readonly ScriptedReply[];
  readonly model?: string;
  readonly prompt?: Parameters<typeof answeredByTheSteps>[1];
  readonly timeoutMs?: number;
  readonly languageModel?: ScriptedLanguageModel['languageModel'];
  readonly tools?: readonly StepTool[];
  readonly send?: (job: ToolCallJob) => Effect.Effect<ToolCallAnswer>;
  readonly bounds?: SteppedRun['bounds'];
  readonly keepsContent?: boolean;
  readonly before?: RunAttempt;
  readonly content?: RecordedContent;
  readonly refusing?: (fact: CallFact) => boolean;
  readonly cancelledAfter?: number;
  readonly journal?: RecordingJournal;
}

type Given = Required<Omit<StepsOptions, 'languageModel' | 'send' | 'timeoutMs' | 'journal'>> &
  Pick<StepsOptions, 'languageModel' | 'send' | 'timeoutMs' | 'journal'>;

function givenNow(options: StepsOptions): Given {
  return {
    replies: [],
    tools: [],
    bounds: defaultBounds,
    keepsContent: true,
    before: { startedAt: new Date().toISOString(), modelCallsBefore: 0, calls: [] },
    content: memoryRecordedContent(),
    refusing: () => false,
    cancelledAfter: Number.POSITIVE_INFINITY,
    model: 'anthropic/claude-sonnet-4-5',
    prompt: { kind: 'prompt', instructions: 'Answer briefly', message: 'Find acme.' },
    ...options,
  };
}

export interface StepsRun {
  readonly journal: RecordingJournal;
  readonly content: RecordedContent;
  readonly requests: ScriptedLanguageModel['requests'];
  readonly sends: () => readonly ToolCallJob[];
  readonly stepping: ReturnType<typeof answeredByTheSteps>;
}

function runOf(given: Given, journal: RecordingJournal, generate: SteppedRun['perform']['modelCall']) {
  const sent: ToolCallJob[] = [];
  const { model, tools, timeoutMs } = given;
  const kept = given.keepsContent ? keptIn(given.content, { org: 'acme', playbook: 'alpha' }) : undefined;
  const send = given.send ?? keptAnswerOf(kept);
  const run: SteppedRun = {
    model,
    base: {
      model,
      output: { type: 'text' },
      settings: { max_output_tokens: 256 },
      ...(timeoutMs === undefined ? {} : { timeout_ms: timeoutMs }),
    },
    tools: {
      offered: tools,
      definitions: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      argumentsDigest: (input) => `digest of ${JSON.stringify(input)}`,
      scrubJson: (json) => json.replaceAll(secretOfTheServers, '[redacted]'),
    },
    bounds: given.bounds,
    journal,
    kept,
    perform: {
      modelCall: generate,
      toolCall: (job) =>
        Effect.suspend(() => {
          sent.push(job);
          return send(job);
        }),
    },
    startedAt: Date.parse(given.before.startedAt),
  };
  return { run, sends: () => [...sent] };
}

export function stepsOf(options: StepsOptions = {}): StepsRun {
  const given = givenNow(options);
  const scripted = scriptedLanguageModel(...given.replies);
  const languageModel = given.languageModel ?? scripted.languageModel;
  const journal = given.journal ?? cancelledAfter(recordingJournal(given.refusing, given.before), given.cancelledAfter);
  const { run, sends } = runOf(given, journal, performedInProcess(languageModel)([]).modelCall);
  return {
    journal,
    content: given.content,
    requests: scripted.requests,
    sends,
    stepping: answeredByTheSteps(run, given.prompt, given.before),
  };
}
