import {
  reportedIssues,
  splitDocument,
  type DocumentIssue,
  type DocumentParts,
  type ReadFrontMatter,
} from '@on.auto/definitions/document';
import { inputVariableIssues } from '@on.auto/definitions/template';
import { Option, Result, type Schema } from 'effect';

import type { CompiledTemplate } from '../template/compiled-template.ts';
import { inputContractOf, outputContractOf } from './definition-schemas.ts';
import { modelOf, providerOptionsOf, settingsOf, toolsOf } from './definition-settings.ts';
import { templateOf } from './definition-template.ts';
import { decodeSection, frontMatterIn } from './front-matter-schema.ts';
import type { ReasoningFunctionDefinitionDocument } from './reasoning-function-definition.ts';

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

function checkedSection<A, B>(decoded: () => Option.Option<A>, check: (section: A) => Checked<B>): Checked<B> {
  return Option.match(decoded(), { onNone: () => Result.fail([]), onSome: check });
}

function issuesOf(...checks: readonly (() => Checked<unknown>)[]): readonly DocumentIssue[] {
  return checks.flatMap((check) => {
    const checked = check();
    return Result.isFailure(checked) ? checked.failure : [];
  });
}

function variablesOf(
  compiled: () => Checked<CompiledTemplate>,
  inputSchema: Schema.JsonObject | undefined,
): readonly DocumentIssue[] {
  const template = compiled();
  return Result.isSuccess(template)
    ? inputVariableIssues(template.success.variables, inputSchema, 'a reasoning function’s prompt template')
    : [];
}

function definitionFrom({ root, lines, issues }: ReadFrontMatter, template: () => Checked<CompiledTemplate>) {
  const model = checkedSection(
    () => decodeSection.model(root['model']),
    (reference) => modelOf(reference, lines),
  );
  const settings = checkedSection(
    () => decodeSection.config(root['config']),
    (config) => settingsOf(config, lines),
  );
  const input = checkedSection(
    () => decodeSection.input(root['input']),
    (section) => inputContractOf(section, lines),
  );
  const output = checkedSection(
    () => decodeSection.output(root['output']),
    (section) => outputContractOf(section, lines),
  );
  const description = checkedSection(() => decodeSection.description(root['description']), Result.succeed);
  const providerOptions = checkedSection(
    () => decodeSection.provider_options(root['provider_options']),
    (options) => providerOptionsOf(options, lines),
  );
  const tools = checkedSection(
    () => decodeSection.tools(root['tools']),
    (written) => toolsOf(written, lines),
  );
  const found = [
    ...issues,
    ...issuesOf(
      () => model,
      () => settings,
      () => input,
      () => output,
      () => providerOptions,
      () => tools,
      () => template(),
    ),
    ...variablesOf(template, Result.isSuccess(input) ? input.success.schema?.document : undefined),
  ];
  return found.length > 0
    ? Result.fail(found)
    : Result.all({ model, settings, input, output, template: template(), description, providerOptions, tools });
}

function definitionOf(parts: DocumentParts): Checked<ReasoningFunctionDefinitionDocument> {
  const template = templateOf(parts);
  const reading = frontMatterIn(parts.frontMatter, parts.frontMatterLine);
  if (Result.isFailure(reading)) {
    return Result.fail([...reading.failure, ...issuesOf(() => template)]);
  }
  return Result.map(
    definitionFrom(reading.success, () => template),
    (definition) => ({
      ...(definition.description === undefined ? {} : { description: definition.description }),
      model: definition.model,
      settings: definition.settings,
      input: definition.input,
      output: definition.output.output,
      ...(definition.providerOptions === undefined ? {} : { provider_options: definition.providerOptions }),
      tools: definition.tools,
      template: definition.template,
      warnings: definition.output.warnings,
    }),
  );
}

export function parseDefinitionDocument(source: string): Checked<ReasoningFunctionDefinitionDocument> {
  return Result.mapError(
    Result.flatMap(splitDocument(source, 'A reasoning function definition'), definitionOf),
    reportedIssues,
  );
}
