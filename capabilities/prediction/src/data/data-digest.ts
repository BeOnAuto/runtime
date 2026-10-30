import { sha256Of } from '@on.auto/operations';
import type { Schema } from 'effect';

import { isMapping } from '../document/checked-parts.ts';
import { isProjected, type DataPart } from '../document/prediction-document.ts';
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
  if (!isProjected(data)) {
    return { dataset: data.dataset, features: [...data.features], period };
  }
  return {
    period,
    events: [...data.events],
    time: data.time,
    series: data.series,
    target: { ...data.target },
    features: data.features.map((feature) => ({ ...feature })),
  };
}

export function dataDigestOf(data: DataPart, period: Grain): string {
  return sha256Of(canonicalJson(dataJsonOf(data, period)));
}
