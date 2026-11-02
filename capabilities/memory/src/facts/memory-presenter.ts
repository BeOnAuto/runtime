import type { CapabilityFacts } from '@on.auto/definitions';
import { changingEvents, type PresentedFact, type Presenter } from '@on.auto/operations';
import { Schema } from 'effect';

import { MemoryFactSchema, type RecordedMemoryFact, type RecordedRemembered } from './memory-fact-schema.ts';
import { memoriesKind } from './memory-facts.ts';
import { destinationInWords } from './memory-streams.ts';

const memoryFactTypes = ['memory_remembered', 'memory_forgotten', 'memory_erased', 'memory_moved'] as const;

const decodeMemoryFact = Schema.decodeUnknownSync(Schema.toCodecJson(MemoryFactSchema));

function rememberedSummary({ data }: RecordedRemembered): string {
  const replacing = data.replaces_version === undefined ? '' : `, which replaces version ${data.replaces_version}`;
  const erased = data.text === null ? ', whose text was erased since' : '';
  return `A memory was remembered, as its version ${data.version}${replacing}${erased}.`;
}

function rememberedShown({ data }: RecordedRemembered): Schema.JsonObject {
  const shown: Schema.JsonObject = { ...data };
  return shown;
}

function endedSummary(type: 'memory_forgotten' | 'memory_erased', version: number): string {
  if (type === 'memory_erased') {
    return `The text of version ${version} of the memory was erased.`;
  }
  return version === 0
    ? 'The memory was forgotten before a version of it was kept, since the memory it was moved from was erased.'
    : `The memory was forgotten, at its version ${version}.`;
}

function presentedOf(fact: RecordedMemoryFact): PresentedFact {
  if (fact.type === 'memory_remembered') {
    return { type: fact.type, summary: rememberedSummary(fact), data: rememberedShown(fact) };
  }
  if (fact.type === 'memory_moved') {
    const { data } = fact;
    return {
      type: fact.type,
      summary: `The memory was moved to ${destinationInWords(data)}, as ${data.as}.`,
      data: { ...data },
    };
  }
  const { version } = fact.data;
  return { type: fact.type, summary: endedSummary(fact.type, version), data: { version } };
}

export const memoryPresenter: Presenter = {
  streamKind: memoriesKind,
  publicNames: Object.fromEntries(memoryFactTypes.map((type) => [type, [type]])),
  present: ({ type, data, context }) => [presentedOf(decodeMemoryFact({ type, data, context }))],
  changes: changingEvents(memoryFactTypes),
};

export const memoryFacts: CapabilityFacts = { onRuns: [], streams: [memoryPresenter] };
