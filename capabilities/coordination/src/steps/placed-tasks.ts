import type { DiagramGroup, DiagramNode, NodeShape } from '@on.auto/definitions';
import {
  field,
  kindOf,
  taskEntries,
  type Json,
  type JsonObject,
  type TaskEntry,
  type TaskKind,
} from '@on.auto/workflow-engine';

import { objectAt } from './task-reading.ts';

export type LabelOf = (kind: TaskKind | undefined, task: JsonObject, name: string) => string;

export interface PlacedTask {
  readonly name: string;
  readonly task: JsonObject;
  readonly kind: TaskKind | undefined;
  readonly step: number;
  readonly node?: number;
  readonly group?: number;
  readonly body: readonly PlacedTask[];
  readonly recovery: readonly PlacedTask[];
  readonly bodyLast: number;
  readonly last: number;
}

export interface Placement {
  readonly tasks: readonly PlacedTask[];
  readonly nodes: readonly DiagramNode[];
  readonly groups: readonly DiagramGroup[];
}

interface GroupDraft {
  readonly label: string;
  readonly within: number | undefined;
}

type GroupedKind = 'for' | 'do' | 'try' | 'fork';

const groupedKinds: ReadonlySet<TaskKind | undefined> = new Set<GroupedKind>(['for', 'do', 'try', 'fork']);

const shapeOfKind: Partial<Readonly<Record<TaskKind, NodeShape>>> = { switch: 'decision', raise: 'terminal' };

function bodyOf(kind: TaskKind | undefined, task: JsonObject): Json | undefined {
  if (kind === 'fork') {
    return field(objectAt(task, 'fork'), 'branches');
  }
  return field(task, kind === 'try' ? 'try' : 'do');
}

function recoveryOf(kind: TaskKind | undefined, task: JsonObject): Json | undefined {
  return kind === 'try' ? field(objectAt(task, 'catch'), 'do') : undefined;
}

function nodeOf(label: string, kind: TaskKind | undefined): DiagramNode {
  const shape = kind === undefined ? undefined : shapeOfKind[kind];
  return shape === undefined ? { label } : { label, shape };
}

function groupOf({ label, within }: GroupDraft, nodes: readonly number[]): DiagramGroup {
  return within === undefined ? { label, nodes } : { label, nodes, within };
}

export function placedTasksOf(list: Json | undefined, entries: number, labelOf: LabelOf): Placement {
  const nodes: DiagramNode[] = [];
  const nodeGroups: (number | undefined)[] = [];
  const drafts: GroupDraft[] = [];
  let steps = 0;

  function placedList(tasks: Json | undefined, within?: number): readonly PlacedTask[] {
    return taskEntries(tasks, '').map((entry) => placedTask(entry, within));
  }

  function placedGroup(entry: TaskEntry, kind: TaskKind | undefined, step: number, within: number | undefined) {
    const group = drafts.length;
    drafts.push({ label: `${step}. ${labelOf(kind, entry.task, entry.name)}`, within });
    const body = placedList(bodyOf(kind, entry.task), group);
    const bodyLast = steps;
    const recovery = placedList(recoveryOf(kind, entry.task), within);
    return { ...entry, kind, step, group, body, recovery, bodyLast, last: steps };
  }

  function placedTask(entry: TaskEntry, within?: number): PlacedTask {
    steps += 1;
    const step = steps;
    const kind = kindOf(entry.task);
    if (groupedKinds.has(kind)) {
      return placedGroup(entry, kind, step, within);
    }
    const node = entries + nodes.length;
    nodes.push(nodeOf(`${step}. ${labelOf(kind, entry.task, entry.name)}`, kind));
    nodeGroups.push(within);
    return { ...entry, kind, step, node, body: [], recovery: [], bodyLast: step, last: step };
  }

  const tasks = placedList(list);
  const groups = drafts.map((draft, group) =>
    groupOf(
      draft,
      nodeGroups.flatMap((within, index) => (within === group ? [entries + index] : [])),
    ),
  );
  return { tasks, nodes, groups };
}
