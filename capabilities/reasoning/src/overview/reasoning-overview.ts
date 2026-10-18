import {
  bulletList,
  inputSection,
  named,
  outputSection,
  paragraph,
  sectionOf,
  type Diagram,
  type OverviewBlock,
  type OverviewParts,
  type OverviewSection,
  type Phrases,
} from '@on.auto/definitions';
import { readableParts } from '@on.auto/definitions/template';
import { writtenOf, type ToolReference } from '@on.auto/tool-servers/policy';
import type { Schema } from 'effect';

import type {
  InputContract,
  ReasoningFunctionDefinitionDocument,
} from '../definition/reasoning-function-definition.ts';
import type { OutputRequest } from '../model/model-request.ts';

type Entry = readonly [string, Schema.Json];

const everyTool = '*';

const everyToolOf = 'every tool of ';

const howTheModelCalls =
  "The model may call these tools before it answers, several in one step and over several steps, within a run's limits on calls, time and failures.";

const functionNode = 0;

const modelNode = 1;

const firstToolNode = 2;

function isRecord(value: Schema.Json | undefined): value is Schema.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withDefault([name, property]: Entry, defaults: Schema.JsonObject): Entry {
  const value = defaults[name];
  return value === undefined || !isRecord(property)
    ? [name, property]
    : [name, Object.fromEntries([...Object.entries(property), ['default', value]])];
}

function documentedInput({ schema, defaults }: InputContract): Schema.JsonObject | undefined {
  const properties = schema?.document['properties'];
  if (schema === undefined || !isRecord(properties)) {
    return schema?.document;
  }
  const withDefaults = Object.entries(properties).map((entry: Entry) => withDefault(entry, defaults));
  return Object.fromEntries([...Object.entries(schema.document), ['properties', Object.fromEntries(withDefaults)]]);
}

function producedSection(output: OutputRequest): OverviewSection {
  return output.type === 'json'
    ? outputSection(output.schema.document, output.shape)
    : sectionOf('What it produces', paragraph('Text: the answer the model writes.'));
}

function toolPhrases({ server, tool }: ToolReference): Phrases {
  return tool === everyTool ? [everyToolOf, named(server)] : ['the tool ', named(tool), ' of ', named(server)];
}

function toolLabel(reference: ToolReference): string {
  return reference.tool === everyTool ? `${everyToolOf}${reference.server}` : writtenOf(reference);
}

function modelAndTools(name: string, { model, tools }: ReasoningFunctionDefinitionDocument): Diagram {
  return {
    kind: 'diagram',
    nodes: [{ label: name }, { label: model }, ...tools.map((tool) => ({ label: toolLabel(tool) }))],
    edges: [
      { from: functionNode, to: modelNode, label: 'reasons with' },
      ...tools.map((_, index) => ({ from: modelNode, to: firstToolNode + index, label: 'may call' })),
    ],
  };
}

function toolBlocks(name: string, definition: ReasoningFunctionDefinitionDocument): readonly OverviewBlock[] {
  const { tools } = definition;
  return tools.length === 0
    ? [paragraph('It calls no tools.')]
    : [
        paragraph('It may call these tools:'),
        bulletList(tools.map((tool) => toolPhrases(tool))),
        modelAndTools(name, definition),
        paragraph(howTheModelCalls),
      ];
}

function modelSection(name: string, definition: ReasoningFunctionDefinitionDocument): OverviewSection {
  return sectionOf(
    'Which model and tools',
    paragraph('It reasons with the model ', { code: definition.model }, '.'),
    ...toolBlocks(name, definition),
  );
}

function toldSection({ template }: ReasoningFunctionDefinitionDocument): OverviewSection {
  const { inside, outside } = readableParts(template, 'system');
  const instructions =
    inside.length === 0 ? [] : [paragraph('Its instructions, which it follows on every run:'), ...inside];
  return sectionOf(
    'What it is told',
    ...instructions,
    paragraph('Its message, with the values of each run in place of the names in bold:'),
    ...outside,
  );
}

export function reasoningOverview(definition: ReasoningFunctionDefinitionDocument, name: string): OverviewParts {
  return {
    body: [],
    sections: [
      inputSection(documentedInput(definition.input)),
      producedSection(definition.output),
      modelSection(name, definition),
      toldSection(definition),
    ],
    appendix: [],
  };
}
