import { definitionResourceLabel, listedPhrases, named, type Phrases } from '@on.auto/definitions';
import { field, textField, type JsonObject } from '@on.auto/workflow-engine';

import { definitionCallOf, literalText, namesItsDefinition } from '../document/workflow-functions.ts';
import { durationText, expressionText, listenedOf, namedKeys, objectAt, runKindOf } from './task-reading.ts';

export function callWords(task: JsonObject): Phrases {
  const call = definitionCallOf(task);
  if (call === undefined) {
    return ['calls ', { code: String(textField(task, 'call')) }];
  }
  return namesItsDefinition(call)
    ? [`runs the ${definitionResourceLabel(call.type)} `, named(call.name)]
    : ['runs the definition its call names when it runs'];
}

export function setWords(task: JsonObject): Phrases {
  const value = field(task, 'set');
  const keys = namedKeys(value) ?? [];
  if (keys.length > 0) {
    return [
      'sets ',
      ...listedPhrases(
        keys.map((key) => [named(key)]),
        'and',
      ),
    ];
  }
  return typeof value === 'string' ? ['sets its data from ', { code: expressionText(value) }] : ['sets its data'];
}

export function listenWords(task: JsonObject): Phrases {
  const { mode, types } = listenedOf(task);
  const events = types.map((type): Phrases =>
    type === undefined ? ['an event sent to the run'] : ['the event ', named(type)],
  );
  if (mode === 'any') {
    return ['waits for the first of ', ...listedPhrases(events, 'or')];
  }
  return [mode === 'all' ? 'waits for each of ' : 'waits for ', ...listedPhrases(events, 'and')];
}

export function waitWords(task: JsonObject): Phrases {
  const duration = durationText(field(task, 'wait'));
  return [duration === undefined ? 'waits for a time computed when it runs' : `waits ${duration}`];
}

export function emitWords(task: JsonObject): Phrases {
  const type = literalText(field(objectAt(task, 'emit', 'event', 'with'), 'type'));
  return type === undefined
    ? ['publishes an event of a type computed when it runs to the playbook']
    : ['publishes the event ', named(type), ' to the playbook'];
}

function statusWords(error: JsonObject): Phrases {
  const status = field(error, 'status');
  return typeof status === 'number' ? [`, with status ${status}`] : [];
}

export function raiseWords(task: JsonObject): Phrases {
  const reference = field(objectAt(task, 'raise'), 'error');
  if (typeof reference === 'string') {
    return ['raises the error ', named(reference), ' its document names under ', { code: 'use.errors' }];
  }
  const error = objectAt(task, 'raise', 'error');
  const title = textField(error, 'title');
  const type = textField(error, 'type');
  if (title !== undefined) {
    return ['raises the error ', { emphasis: title }, ...statusWords(error)];
  }
  return type === undefined
    ? ['raises an error']
    : ['raises an error of the type ', { code: type }, ...statusWords(error)];
}

export function runWords(task: JsonObject): Phrases {
  const kind = runKindOf(task);
  return [kind === undefined ? 'runs a process' : `runs a ${kind}`];
}
