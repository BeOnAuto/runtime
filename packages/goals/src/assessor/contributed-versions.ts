import {
  DefinitionEventSchema,
  carriesContent,
  definitionTypeStreamOf,
  type RecordedDefinitionEvent,
} from '@on.auto/definitions';
import { contributesIn, type Contributes } from '@on.auto/definitions/goals';
import type { Fold, StreamReader } from '@on.auto/operations';
import { Effect } from 'effect';

export const mostVersionsKept = 64;

interface WorkflowVersion {
  readonly playbookKey: string;
  readonly name: string;
  readonly version: number;
}

export interface ContributedVersions {
  readonly contributesOf: (reader: StreamReader, version: WorkflowVersion) => Effect.Effect<Contributes>;
  readonly reads: () => number;
}

const workflowStream = definitionTypeStreamOf('workflow');

function versionFold(name: string, version: number): Fold<Contributes, RecordedDefinitionEvent> {
  return {
    initialState: [],
    evolve: (found, event) =>
      carriesContent(event) && event.context.definitionName === name && event.context.definitionVersion === version
        ? (contributesIn(event.data.content.details) ?? [])
        : found,
    eventSchema: DefinitionEventSchema,
  };
}

export function contributedVersionsOf(): ContributedVersions {
  const kept = new Map<string, Contributes>();
  const counted = { reads: 0 };
  const remembered = (key: string, contributes: Contributes): Contributes => {
    kept.delete(key);
    kept.set(key, contributes);
    for (const oldest of [...kept.keys()].slice(0, Math.max(0, kept.size - mostVersionsKept))) {
      kept.delete(oldest);
    }
    return contributes;
  };
  return {
    contributesOf: (reader, { playbookKey, name, version }) =>
      Effect.suspend(() => {
        const key = `${playbookKey}${name}@${String(version)}`;
        const held = kept.get(key);
        if (held !== undefined) {
          return Effect.succeed(remembered(key, held));
        }
        counted.reads += 1;
        return Effect.map(reader.load(workflowStream, versionFold(name, version)), ({ state }) =>
          remembered(key, state),
        );
      }),
    reads: () => counted.reads,
  };
}
