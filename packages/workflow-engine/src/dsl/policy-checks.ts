import { readDuration } from './durations.ts';
import { enclosedBody } from './expressions.ts';
import { field, isObject, objectField, type Json, type JsonObject } from './json.ts';

export interface Rejection {
  readonly pointer: string;
  readonly detail: string;
  readonly forbidden: boolean;
}

export interface Components {
  readonly errors: JsonObject;
  readonly retries: JsonObject;
  readonly timeouts: JsonObject;
}

export type Located = readonly [Json | undefined, string];

export function rejection(pointer: string, detail: string): Rejection {
  return { pointer, detail, forbidden: false };
}

export function forbidden(pointer: string, detail: string): Rejection {
  return { pointer, detail, forbidden: true };
}

export function durationRejections(duration: Json | undefined, pointer: string): readonly Rejection[] {
  if (duration === undefined || enclosedBody(duration) !== undefined) {
    return [];
  }
  const reading = readDuration(duration);
  return 'problem' in reading ? [rejection(pointer, reading.problem)] : [];
}

export function timeoutRejections(
  timeout: Json | undefined,
  pointer: string,
  components: Components,
): readonly Rejection[] {
  if (typeof timeout === 'string') {
    return field(components.timeouts, timeout) === undefined
      ? [rejection(pointer, `use.timeouts has no timeout ${timeout}`)]
      : [];
  }
  return isObject(timeout) ? durationRejections(field(timeout, 'after'), `${pointer}/after`) : [];
}

export function retryPolicyRejections(policy: JsonObject, pointer: string): readonly Rejection[] {
  const limit = objectField(policy, 'limit') ?? {};
  const jitter = objectField(policy, 'jitter') ?? {};
  const durations: readonly Located[] = [
    [field(policy, 'delay'), `${pointer}/delay`],
    [field(jitter, 'from'), `${pointer}/jitter/from`],
    [field(jitter, 'to'), `${pointer}/jitter/to`],
    [field(limit, 'duration'), `${pointer}/limit/duration`],
    [field(objectField(limit, 'attempt') ?? {}, 'duration'), `${pointer}/limit/attempt/duration`],
  ];
  return durations.flatMap(([duration, at]: Located) => durationRejections(duration, at));
}
