import { alternatives, listed, quoted } from '@on.auto/operations';
import { field, textField, type JsonObject } from '@on.auto/workflow-engine';

import { definitionCallOf, literalText } from '../document/workflow-functions.ts';
import { durationText, expressionText, listenedOf, namedKeys, objectAt, runKindOf } from './task-reading.ts';

export function callLabel(task: JsonObject): string {
  const call = definitionCallOf(task);
  if (call === undefined) {
    return `Call ${String(textField(task, 'call'))}`;
  }
  return call.name === undefined ? 'Run a definition' : `Run ${call.name}`;
}

export function setLabel(task: JsonObject): string {
  const keys = namedKeys(field(task, 'set'));
  return keys === undefined || keys.length === 0 ? 'Set its data' : `Set ${listed(keys)}`;
}

export function listenLabel(task: JsonObject): string {
  const { mode, types } = listenedOf(task);
  const named = types.map((type) => type ?? 'an event sent to the run');
  return `Wait for ${mode === 'all' ? listed(named) : alternatives(named)}`;
}

export function waitLabel(task: JsonObject): string {
  const duration = durationText(field(task, 'wait'));
  return duration === undefined ? 'Wait' : `Wait ${duration}`;
}

export function emitLabel(task: JsonObject): string {
  const type = literalText(field(objectAt(task, 'emit', 'event', 'with'), 'type'));
  return type === undefined ? 'Publish an event' : `Publish ${type}`;
}

export function raiseLabel(task: JsonObject): string {
  const error = field(objectAt(task, 'raise'), 'error');
  if (typeof error === 'string') {
    return `Raise ${error}`;
  }
  const title = textField(objectAt(task, 'raise', 'error'), 'title');
  return title === undefined ? 'Raise an error' : `Raise ${quoted(title)}`;
}

export function runLabel(task: JsonObject): string {
  const kind = runKindOf(task);
  return kind === undefined ? 'Run a process' : `Run a ${kind}`;
}

export function forLabel(task: JsonObject): string {
  const loop = objectAt(task, 'for');
  return `For each ${textField(loop, 'each') ?? 'item'} of ${expressionText(field(loop, 'in') ?? null)}`;
}

export function forkLabel(task: JsonObject): string {
  return field(objectAt(task, 'fork'), 'compete') === true ? 'At once, the first to finish wins' : 'At once';
}
