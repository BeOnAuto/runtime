import { readDuration } from './durations.ts';
import { entriesOf, field, isObject, objectField, type Json, type JsonEntry, type JsonObject } from './json.ts';
import { rejection, type Located, type Rejection } from './policy-checks.ts';
import { allTaskEntries, pointerTo, type TaskEntry } from './tasks.ts';

export function durationLimitRejections(document: JsonObject, mostDuration: number): readonly Rejection[] {
  const timeouts = entriesOf(objectField(objectField(document, 'use') ?? {}, 'timeouts') ?? {}).map(
    ([name, timeout]: JsonEntry): Located => [afterOf(timeout), `${pointerTo('/use/timeouts', name)}/after`],
  );
  const durations: readonly Located[] = [
    [afterOf(field(document, 'timeout')), '/timeout/after'],
    ...timeouts,
    ...allTaskEntries(field(document, 'do'), '/do').flatMap((entry) => durationsOf(entry)),
  ];
  return durations.flatMap(([duration, pointer]: Located) => {
    const reading = readDuration(duration ?? null);
    return 'milliseconds' in reading && reading.milliseconds > mostDuration
      ? [
          rejection(
            pointer,
            `This duration, ${reading.milliseconds} ms, is longer than the ${mostDuration} ms a workflow may run`,
          ),
        ]
      : [];
  });
}

function durationsOf({ task, reference }: TaskEntry): readonly Located[] {
  return [
    [field(task, 'wait'), `${reference}/wait`],
    [afterOf(field(task, 'timeout')), `${reference}/timeout/after`],
  ];
}

function afterOf(timeout: Json | undefined): Json | undefined {
  return isObject(timeout) ? field(timeout, 'after') : undefined;
}
