import type { RecordedWork } from '@on.auto/definitions';
import { Schema } from 'effect';

import { interactionFactOf } from '../facts/run-facts.ts';

export interface Setting {
  readonly at: string;
  readonly value: Schema.Json;
  readonly by: string;
  readonly time: string;
}

export function settingsOf(work: readonly RecordedWork[]): readonly Setting[] {
  return work.flatMap((recorded) => {
    const fact = interactionFactOf(recorded);
    return fact?.type === 'answer_set'
      ? fact.data.parts.map(({ at, value }) => ({
          at,
          value,
          by: fact.data.click.sender,
          time: recorded.context.at,
        }))
      : [];
  });
}

const isObject = Schema.is(Schema.JsonObject);

const isList = Schema.is(Schema.Array(Schema.Json));

function segmentsOf(place: string): readonly string[] {
  return place
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function indexIn(list: readonly Schema.Json[], segment: string): number | undefined {
  const index = Number(segment);
  return Number.isInteger(index) && index >= 0 && index <= list.length ? index : undefined;
}

function childOf(root: Schema.Json, segment: string): Schema.Json {
  if (isObject(root)) {
    return root[segment] ?? null;
  }
  const index = isList(root) ? indexIn(root, segment) : undefined;
  return isList(root) && index !== undefined ? (root[index] ?? null) : null;
}

function withValueAt(root: Schema.Json, segments: readonly string[], value: Schema.Json): Schema.Json {
  const [head, ...rest] = segments;
  if (head === undefined) {
    return value;
  }
  const inside = withValueAt(childOf(root, head), rest, value);
  const index = isList(root) ? indexIn(root, head) : undefined;
  if (isList(root) && index !== undefined) {
    return root.toSpliced(index, 1, inside);
  }
  return Object.assign({}, isObject(root) ? root : {}, { [head]: inside });
}

export function answerSoFar(settings: readonly Setting[]): Schema.Json {
  return settings.reduce<Schema.Json>((answer, { at, value }) => withValueAt(answer, segmentsOf(at), value), {});
}

export function answeredSoFar(settings: readonly Setting[]): Schema.Json {
  return settings.reduce<Schema.Json>(
    (answered, { at, by, time }) => withValueAt(answered, segmentsOf(at), { by, at: time }),
    {},
  );
}
