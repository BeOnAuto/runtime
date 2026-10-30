import { issueAt, type DocumentIssue, type SourceLines } from '@on.auto/definitions/document';
import { toolReferenceOf, toolReferenceShape, type ToolReference } from '@on.auto/tool-servers/policy';
import { JsonPointer, Option, Result, type Schema } from 'effect';

import { parseModelReference } from '../model/model-reference.ts';
import type { GenerationSettings } from '../model/model-request.ts';
import { optionCheckFor, providerNamespaces } from '../model/offered-provider-options.ts';
import { requestIssues } from '../model/request-checks.ts';
import type { ConfigSection } from './front-matter-schema.ts';

type ProviderOptions = Readonly<Record<string, Schema.JsonObject>>;

const defaultOutputTokens = 1024;

export const mostOutputTokens = 64_000;

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
