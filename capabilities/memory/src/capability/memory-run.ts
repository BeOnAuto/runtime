import {
  checkedInput,
  functionResourceLabels,
  type CapabilityAnswer,
  type CapabilityRejection,
  type RunContext,
} from '@on.auto/definitions';
import { renderClock } from '@on.auto/definitions/template';
import { Conflict, type Context } from '@on.auto/operations';
import { Clock, Effect, type Schema } from 'effect';

import type { MemoryFunctionDefinitionDocument, RecallBlock, RememberBlock } from '../document/memory-document.ts';
import { recalled } from '../recall/recalling.ts';
import { remembered } from '../remember/remembering.ts';
import type { MemoryPorts } from './memory-ports.ts';
import { renderedMemory, renderedReplaces, renderedTags, renderedWords } from './rendered-memory.ts';
import type { Rendering } from './rendered-text.ts';

export const memoryDefinitionType = 'memory';

interface Moment {
  readonly rendering: Rendering;
  readonly now: number;
}

function missingAsUnworkable({ detail }: { readonly detail: string }): Effect.Effect<never, Conflict> {
  return Effect.fail(new Conflict({ detail, kind: 'unworkable' }));
}

const rememberRun = Effect.fnUntraced(function* (
  ports: MemoryPorts,
  block: RememberBlock,
  context: RunContext,
  { rendering, now }: Moment,
) {
  const memory = yield* renderedMemory(block, rendering, now);
  const replaces = yield* renderedReplaces(block, rendering);
  const asked = { memory, scope: block.scope, id: replaces ?? ports.newId(), replaces: replaces !== undefined };
  const kept = yield* remembered(ports, placeOfTheRun(context), asked, actingOfTheRun(context, now)).pipe(
    Effect.catchTag('not_found', missingAsUnworkable),
  );
  const answer: CapabilityAnswer = { output: kept, record: {} };
  return answer;
});

const recallRun = Effect.fnUntraced(function* (
  ports: MemoryPorts,
  block: RecallBlock,
  context: RunContext,
  { rendering, now }: Moment,
) {
  const words = yield* renderedWords(block, rendering);
  const tags = yield* renderedTags(block, rendering);
  const asked = { words, tags, scope: block.scope, mostCharacters: block.mostCharacters };
  const made = yield* recalled(ports, placeOfTheRun(context), asked, new Date(now).toISOString());
  const answer: CapabilityAnswer = {
    output: made.recalled,
    record: { examined: made.examined, recalled: made.recalled.memories.length },
  };
  return answer;
});

function contextOfTheRun(context: RunContext, at: string): Context {
  return {
    at,
    by: context.caller.id,
    runId: context.id,
    definitionType: memoryDefinitionType,
    definitionName: context.definition.name,
    definitionVersion: context.definition.version,
  };
}

function placeOfTheRun({ org, playbook }: RunContext) {
  return { org, playbook };
}

function actingOfTheRun(context: RunContext, now: number) {
  return {
    context: contextOfTheRun(context, new Date(now).toISOString()),
    lineage: { causationId: context.lineage.startId, correlationId: context.lineage.correlationId },
  };
}

const runOf = Effect.fnUntraced(function* (
  ports: MemoryPorts,
  { input: contract, block }: MemoryFunctionDefinitionDocument,
  input: Schema.Json,
  context: RunContext,
) {
  const checked = yield* checkedInput(input, contract.schema, functionResourceLabels.memory.singular);
  const now = yield* Clock.currentTimeMillis;
  const at = new Date(now).toISOString();
  const rendering = { variables: { input: checked, today: at.slice(0, 10), now: at }, clock: yield* renderClock };
  if (block.kind === 'recall') {
    return yield* recallRun(ports, block.recall, context, { rendering, now });
  }
  return yield* rememberRun(ports, block.remember, context, { rendering, now });
});

export function memoryRun(
  ports: MemoryPorts,
): (
  document: MemoryFunctionDefinitionDocument,
  input: Schema.Json,
  context: RunContext,
) => Effect.Effect<CapabilityAnswer, CapabilityRejection> {
  return (document, input, context) => runOf(ports, document, input, context);
}
