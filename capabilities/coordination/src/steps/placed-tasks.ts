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

export interface NumberedTask {
  readonly name: string;
  readonly task: JsonObject;
  readonly kind: TaskKind | undefined;
  readonly step: number;
  readonly body: readonly NumberedTask[];
  readonly recovery: readonly NumberedTask[];
  readonly bodyLast: number;
  readonly last: number;
}

export interface PlacedTask extends NumberedTask {
  readonly node?: number;
  readonly group?: number;
  readonly body: readonly PlacedTask[];
  readonly recovery: readonly PlacedTask[];
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

export function numberedTasksOf(list: Json | undefined): readonly NumberedTask[] {
  let steps = 0;

  function numberedList(tasks: Json | undefined): readonly NumberedTask[] {
    return taskEntries(tasks, '').map((entry) => numberedTask(entry));
  }

  function numberedTask({ name, task }: TaskEntry): NumberedTask {
    steps += 1;
    const step = steps;
    const kind = kindOf(task);
    if (!groupedKinds.has(kind)) {
      return { name, task, kind, step, body: [], recovery: [], bodyLast: step, last: step };
    }
    const body = numberedList(bodyOf(kind, task));
    const bodyLast = steps;
    const recovery = numberedList(recoveryOf(kind, task));
    return { name, task, kind, step, body, recovery, bodyLast, last: steps };
  }

  return numberedList(list);
}

export function placedTasksOf(list: Json | undefined, entries: number, labelOf: LabelOf): Placement {
  const nodes: DiagramNode[] = [];
  const nodeGroups: (number | undefined)[] = [];
  const drafts: GroupDraft[] = [];

  function placedTask(numbered: NumberedTask, within?: number): PlacedTask {
    const { name, task, kind, step } = numbered;
    const label = `${step}. ${labelOf(kind, task, name)}`;
    if (!groupedKinds.has(kind)) {
      const node = entries + nodes.length;
      nodes.push(nodeOf(label, kind));
      nodeGroups.push(within);
      return { ...numbered, node, body: [], recovery: [] };
    }
    const group = drafts.length;
    drafts.push({ label, within });
    const body = numbered.body.map((inner) => placedTask(inner, group));
    const recovery = numbered.recovery.map((inner) => placedTask(inner, within));
    return { ...numbered, group, body, recovery };
  }

  const tasks = numberedTasksOf(list).map((numbered) => placedTask(numbered));
  const groups = drafts.map((draft, group) =>
    groupOf(
      draft,
      nodeGroups.flatMap((within, index) => (within === group ? [entries + index] : [])),
    ),
  );
  return { tasks, nodes, groups };
}
