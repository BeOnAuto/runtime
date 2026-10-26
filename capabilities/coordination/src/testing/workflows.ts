import type { CallerIdentity } from '@on.auto/operations';
import type { Json, JsonObject } from '@on.auto/workflow-engine';
import { Schema } from 'effect';
import { parse } from 'yaml';

import type { DefinitionResponder } from './machine-commands.ts';
import type { Command, MachineHost, WorkflowStart } from './machine-host.ts';
import { interpretOnMachine, outputsAtOnce, type MachineInterpretation } from './machine-workflows.ts';
import {
  defaultLongestNestedRunMs,
  defaultMostDuration,
  type DefinitionCall,
  type DefinitionCallResult,
  type WorkflowRun,
} from './run-terms.ts';

export interface InterpretOptions {
  readonly input?: Json;
  readonly respond?: DefinitionResponder;
  readonly started?: (start: WorkflowStart, host: MachineHost) => void;
  readonly mostDuration?: number;
  readonly longestNestedRunMs?: number;
}

export const acmeCaller: CallerIdentity = {
  id: 'acme-admin',
  name: 'acme-admin',
  org: 'acme',
  permissions: ['playbook:read', 'playbook:write'],
  playbooks: '*',
};

export const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export const header = { dsl: '1.0.3', namespace: 'acme', name: 'test', version: '1.0.0' };

const decodeObject = Schema.decodeUnknownSync(Schema.JsonObject);

export function yamlObject(source: string): JsonObject {
  return decodeObject(parse(source));
}

export function workflow(source: string): JsonObject {
  return { document: header, ...yamlObject(source) };
}

function runOf(document: JsonObject, input: Json = {}): WorkflowRun {
  return {
    document,
    input,
    run: { id: runId, org: 'acme', playbook: 'alpha', definition: { name: 'test-flow', version: 1 } },
    caller: acmeCaller,
    mostDuration: defaultMostDuration,
    longestNestedRunMs: defaultLongestNestedRunMs,
  };
}

export function neverAnswers(): Promise<DefinitionCallResult> {
  return Promise.withResolvers<DefinitionCallResult>().promise;
}

export function callsIn(commands: readonly Command[]): readonly DefinitionCall[] {
  return commands.flatMap((command) => (command.kind === 'call' ? [command.call] : []));
}

export function interpret(document: JsonObject, options: InterpretOptions = {}): Promise<MachineInterpretation> {
  const run = runOf(document, options.input ?? {});
  return interpretOnMachine(
    {
      ...run,
      mostDuration: options.mostDuration ?? run.mostDuration,
      longestNestedRunMs: options.longestNestedRunMs ?? run.longestNestedRunMs,
    },
    options,
  );
}

export function outputsAtTimeZero(document: JsonObject, input: Json = {}): ReturnType<typeof outputsAtOnce> {
  return outputsAtOnce(runOf(document, input));
}

export const workflowExample = [
  "document: {dsl: '1.0.3', namespace: support, name: triage, version: '1.0.0'}",
  'do:',
  '  - classify:',
  '      call: run_definition',
  "      with: {type: reasoning, name: classify-ticket, input: {ticket: '${ $data.ticket }'}}",
  "      output: {as: '${ ({ ...$input, triage: $data }) }'}",
  '  - escalate:',
  '      if: $data.triage.urgency === "high"',
  '      call: run_definition',
  "      with: {type: reasoning, name: draft-escalation, input: {ticket: '${ $data.ticket }'}}",
  "      output: {as: '${ ({ ...$input, note: $data }) }'}",
  '  - approval:',
  '      if: $data.note != null',
  '      listen: {to: {one: {with: {type: com.acme.escalation.approved}}}}',
  "      output: {as: '${ ({ ...$input, approved_by: $data[0].by }) }'}",
].join('\n');
