import { issueAt, type DocumentIssue, type SourceLines } from '@on.auto/definitions/document';
import { toolBounds, toolReferenceOf, toolReferenceShape, type ToolReference } from '@on.auto/tool-servers/policy';
import { JsonPointer, Option, Result, type Schema } from 'effect';

import { parseModelReference } from '../model/model-reference.ts';
import type { GenerationSettings } from '../model/model-request.ts';
import { optionCheckFor, providerNamespaces } from '../model/offered-provider-options.ts';
import { requestIssues } from '../model/request-checks.ts';
import { inputTokensRange } from '../settings/input-token-settings.ts';
import type { ConfigSection, ExitBehavior } from './front-matter-schema.ts';

type ProviderOptions = Readonly<Record<string, Schema.JsonObject>>;

const defaultOutputTokens = 1024;

export const mostOutputTokens = 64_000;

const stoppedAtALimit: ExitBehavior = 'error';

const inputTokensExpected = `Expected a whole number from ${inputTokensRange.least} to ${inputTokensRange.most}`;

export const mostToolCalls = 1000;

const toolCallsRange = `Expected a whole number from 1 to ${mostToolCalls}`;

const noToolCalls = `${toolCallsRange}. To let the function call no tools, leave out tools`;

const pastMostToolCalls = `Expected at most ${mostToolCalls}. Left out, a run counts only its calls of tools not marked reads, to ${toolBounds.actingCallsInRun}, and its time and its input tokens bound the rest`;

const maxToolCallsWithoutTools =
  'max_tool_calls sets how many tool calls a run may make, which only a function that names tools makes; leave it out';

const exitBehaviorWithoutTools =
  'exit_behavior sets how a run ends at its limit of tool calls or of input tokens across its steps, which only a function that names tools has; leave it out';

const settingsPointer = /^\/settings/u;

const gatewayNamespace = /^[a-z][a-zA-Z0-9-]{0,31}$/u;

const namespaces = `provider_options takes ${providerNamespaces.join(', ')}, or the name of a gateway`;

export function modelOf(model: string, lines: SourceLines): Result.Result<string, readonly DocumentIssue[]> {
  return Option.isNone(parseModelReference(model))
    ? Result.fail([issueAt(lines, '/model', 'Expected provider/model, for example anthropic/claude-sonnet-4-5')])
    : Result.succeed(model);
}

export function settingsOf(
  config: ConfigSection,
  lines: SourceLines,
): Result.Result<GenerationSettings, readonly DocumentIssue[]> {
  const { max_output_tokens = defaultOutputTokens, ...others } = config ?? {};
  const settings = { max_output_tokens, ...others };
  const issues = [
    ...requestIssues({
      model: '',
      messages: [{ role: 'user', content: [{ type: 'text', text: '' }] }],
      output: { type: 'text' },
      settings,
    }).map(({ pointer, detail }) => issueAt(lines, pointer.replace(settingsPointer, '/config'), detail)),
    ...(max_output_tokens > mostOutputTokens
      ? [issueAt(lines, '/config/max_output_tokens', `Expected at most ${mostOutputTokens}`)]
      : []),
  ];
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(settings);
}

function pointerOf(path: readonly string[]): string {
  return `/provider_options${path.map((token) => `/${JsonPointer.escapeToken(token)}`).join('')}`;
}

function namespaceIssues(namespace: string, values: Schema.JsonObject, lines: SourceLines): readonly DocumentIssue[] {
  const check = optionCheckFor(namespace);
  if (check === undefined) {
    return gatewayNamespace.test(namespace)
      ? []
      : [issueAt(lines, pointerOf([namespace]), `${namespace} is not a provider namespace: ${namespaces}`)];
  }
  return Object.entries(values).flatMap(([option, value]: readonly [string, Schema.Json]) =>
    check(option, value).map(({ path, detail }) => issueAt(lines, pointerOf([namespace, ...path]), detail)),
  );
}

export function providerOptionsOf(
  options: ProviderOptions | undefined,
  lines: SourceLines,
): Result.Result<ProviderOptions | undefined, readonly DocumentIssue[]> {
  const issues = Object.entries(options ?? {}).flatMap(([namespace, values]: readonly [string, Schema.JsonObject]) =>
    namespaceIssues(namespace, values, lines),
  );
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(options);
}

function toolIssue(written: string, index: number, all: readonly string[]): string | undefined {
  if (toolReferenceOf(written) === undefined) {
    return `Expected ${toolReferenceShape}`;
  }
  return all.indexOf(written) < index ? `${written} is listed twice` : undefined;
}

export function toolsOf(
  written: readonly string[] | undefined,
  lines: SourceLines,
): Result.Result<readonly ToolReference[], readonly DocumentIssue[]> {
  const listed = written ?? [];
  const issues = listed.flatMap((each, index) => {
    const detail = toolIssue(each, index, listed);
    return detail === undefined ? [] : [issueAt(lines, `/tools/${index}`, detail)];
  });
  return issues.length > 0
    ? Result.fail(issues)
    : Result.succeed(listed.flatMap((each) => [toolReferenceOf(each)].filter((reference) => reference !== undefined)));
}

function isWithinTheInputTokensRange(written: number): boolean {
  return Number.isSafeInteger(written) && written >= inputTokensRange.least && written <= inputTokensRange.most;
}

export function maxInputTokensOf(
  written: number | undefined,
  lines: SourceLines,
): Result.Result<number | undefined, readonly DocumentIssue[]> {
  return written === undefined || isWithinTheInputTokensRange(written)
    ? Result.succeed(written)
    : Result.fail([issueAt(lines, '/max_input_tokens', inputTokensExpected)]);
}

export function exitBehaviorOf(
  written: ExitBehavior | undefined,
  namesTools: boolean,
  lines: SourceLines,
): Result.Result<ExitBehavior, readonly DocumentIssue[]> {
  if (written === undefined) {
    return Result.succeed(stoppedAtALimit);
  }
  return namesTools
    ? Result.succeed(written)
    : Result.fail([issueAt(lines, '/exit_behavior', exitBehaviorWithoutTools)]);
}

function toolCallsIssue(written: number): string | undefined {
  if (written === 0) {
    return noToolCalls;
  }
  if (!Number.isSafeInteger(written) || written < 1) {
    return toolCallsRange;
  }
  return written > mostToolCalls ? pastMostToolCalls : undefined;
}

export function maxToolCallsOf(
  written: number | undefined,
  namesTools: boolean,
  lines: SourceLines,
): Result.Result<number | undefined, readonly DocumentIssue[]> {
  if (written === undefined) {
    return Result.succeed(written);
  }
  const detail = namesTools ? toolCallsIssue(written) : maxToolCallsWithoutTools;
  return detail === undefined ? Result.succeed(written) : Result.fail([issueAt(lines, '/max_tool_calls', detail)]);
}
