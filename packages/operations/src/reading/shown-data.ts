import type { Schema } from 'effect';

import { mostPublicEventDataBytes, mostShownFieldBytes, mostToolFieldBytes } from './public-event.ts';

export type EventView = 'page' | 'whole' | 'tool';

const largeFields: readonly string[] = [
  'input',
  'output',
  'record',
  'answer',
  'arguments',
  'result',
  'data',
  'messages',
  'response',
  'tool_calls',
  'warnings',
  'issues',
];

const utf8 = new TextEncoder();

function bytesOf(value: unknown): number {
  return utf8.encode(JSON.stringify(value)).byteLength;
}

function sizedField(data: Schema.JsonObject, name: string): Schema.JsonObject {
  const sizeName = `${name}_bytes`;
  const shown: Record<string, Schema.Json> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key !== name) {
      shown[key] = value;
    } else if (!(sizeName in data)) {
      shown[sizeName] = bytesOf(value);
    }
  }
  return shown;
}

function withoutField(data: Schema.JsonObject, name: string): Schema.JsonObject {
  return Object.fromEntries(Object.entries(data).filter(([key]: readonly [string, Schema.Json]) => key !== name));
}

function sizedPast(data: Schema.JsonObject, names: readonly string[], mostBytes: number): Schema.JsonObject {
  let shown = data;
  for (const name of names) {
    if (name in shown && bytesOf(shown[name]) > mostBytes) {
      shown = sizedField(shown, name);
    }
  }
  return shown;
}

function largestOf(data: Schema.JsonObject): string | undefined {
  let largest: string | undefined;
  let largestBytes = 0;
  for (const name of largeFields) {
    const bytes = name in data ? bytesOf(data[name]) : 0;
    if (bytes > largestBytes) {
      largest = name;
      largestBytes = bytes;
    }
  }
  return largest;
}

function withinThePage(data: Schema.JsonObject): Schema.JsonObject {
  let shown = sizedPast(withoutField(data, 'result'), largeFields, mostShownFieldBytes);
  let largest = largestOf(shown);
  while (bytesOf(shown) > mostPublicEventDataBytes && largest !== undefined) {
    shown = sizedField(shown, largest);
    largest = largestOf(shown);
  }
  return shown;
}

export function shownData(data: Schema.JsonObject, view: EventView): Schema.JsonObject {
  if (view === 'page') {
    return withinThePage(data);
  }
  return view === 'tool' ? sizedPast(data, largeFields, mostToolFieldBytes) : data;
}
