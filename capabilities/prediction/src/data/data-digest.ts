import { sha256Of } from '@on.auto/operations';
import type { Schema } from 'effect';

import { isMapping } from '../document/checked-parts.ts';
import type { DataPart } from '../document/prediction-document.ts';
import type { Grain } from '../periods/grains.ts';

export function canonicalJson(value: Schema.Json): string {
  if (Array.isArray(value)) {
    return `[${value.map((item: Schema.Json) => canonicalJson(item)).join(',')}]`;
  }
  if (isMapping(value)) {
    const entries = Object.entries(value).toSorted(
      ([one]: readonly [string, Schema.Json], [other]: readonly [string, Schema.Json]) => (one < other ? -1 : 1),
    );
    return `{${entries.map(([key, item]: readonly [string, Schema.Json]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function dataJsonOf(data: DataPart, period: Grain): Schema.JsonObject {
  return {
    period,
    events: [...data.events],
    time: data.time,
    series: data.series,
    target: { ...data.target },
  };
}

export function digestOfData(json: Schema.JsonObject): string {
  return sha256Of(canonicalJson(json));
}

export function dataDigestOf(data: DataPart, period: Grain): string {
  return digestOfData(dataJsonOf(data, period));
}
