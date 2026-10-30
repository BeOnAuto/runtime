import { Effect } from 'effect';

import {
  runStreamOf,
  streamPrefixOfPlaybook,
  type ProjectedMessage,
  type RunOutcome,
  type RunOutcomeGroup,
  type RunOutcomeMapping,
  type RunOutcomeSelection,
  type RunOutcomeWindow,
  type RunOutcomesReader,
} from '../index.ts';
import { projectedMessagesOf, type AppendedFact } from '../projections/memory-projections.ts';

interface KeptOutcome {
  readonly playbookKey: string;
  readonly row: RunOutcome;
}

export interface MemoryRunOutcomes {
  readonly project: (stream: string, facts: readonly AppendedFact[], firstPosition: number) => void;
  readonly readRunOutcomes: RunOutcomesReader['readRunOutcomes'];
}

function isSelected(row: RunOutcome, window: RunOutcomeWindow, { definitionType, name }: RunOutcomeSelection): boolean {
  return (
    row.startedDay >= window.from &&
    row.startedDay <= window.to &&
    (definitionType === undefined || row.definitionType === definitionType) &&
    (name === undefined || row.name === name)
  );
}

function emptyGroupOf({ startedDay: day, definitionType, name, status }: RunOutcome): RunOutcomeGroup {
  return {
    day,
    definitionType,
    name,
    status,
    runs: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    durations: [],
  };
}

function added(group: RunOutcomeGroup, row: RunOutcome): RunOutcomeGroup {
  return {
    ...group,
    runs: group.runs + 1,
    inputTokens: group.inputTokens + (row.inputTokens ?? 0),
    outputTokens: group.outputTokens + (row.outputTokens ?? 0),
    cachedTokens: group.cachedTokens + (row.cachedTokens ?? 0),
    durations: row.durationMs === null ? group.durations : [...group.durations, row.durationMs],
  };
}

function grouped(rows: readonly RunOutcome[]): readonly RunOutcomeGroup[] {
  const groups = new Map<string, RunOutcomeGroup>();
  for (const row of rows) {
    const key = JSON.stringify([row.startedDay, row.definitionType, row.name, row.status]);
    groups.set(key, added(groups.get(key) ?? emptyGroupOf(row), row));
  }
  return [...groups.values()];
}

function stagedOutcomes(
  { types, rowAfter }: RunOutcomeMapping,
  kept: ReadonlyMap<string, KeptOutcome>,
  stream: string,
): (staged: ReadonlyMap<string, KeptOutcome>, message: ProjectedMessage) => ReadonlyMap<string, KeptOutcome> {
  const run = runStreamOf(stream);
  return (staged, message) => {
    if (run === undefined || !types.includes(message.type)) {
      return staged;
    }
    const key = `${run.playbookKey}${run.runId}`;
    const row = rowAfter((staged.get(key) ?? kept.get(key))?.row, message);
    return row === undefined ? staged : new Map([...staged, [key, { playbookKey: run.playbookKey, row }]]);
  };
}

export function memoryRunOutcomes(mapping: RunOutcomeMapping | undefined): MemoryRunOutcomes {
  const kept = new Map<string, KeptOutcome>();
  return {
    project: (stream, facts, firstPosition) => {
      if (mapping === undefined) {
        return;
      }
      const messages = projectedMessagesOf(stream, facts, firstPosition);
      const stage = stagedOutcomes(mapping, kept, stream);
      const staged = messages.reduce<ReadonlyMap<string, KeptOutcome>>(
        (outcomes, message) => stage(outcomes, message),
        new Map(),
      );
      for (const [key, outcome] of staged) {
        kept.set(key, outcome);
      }
    },
    readRunOutcomes: (playbook, window, selection) =>
      Effect.sync(() => {
        const playbookKey = streamPrefixOfPlaybook(playbook);
        const rows = [...kept.values()].flatMap((outcome) =>
          outcome.playbookKey === playbookKey ? [outcome.row] : [],
        );
        return grouped(rows.filter((row) => isSelected(row, window, selection)));
      }),
  };
}
