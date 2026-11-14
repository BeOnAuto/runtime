import type { EntryRule } from '../goal-rules/entry-rule.ts';
import type { Instant } from '../goal-rules/goal-rule.ts';
import { aDay } from '../goal-windows/goal-durations.ts';
import { resolvedAt } from './json-pointer.ts';
import type { ObservedMeasurement } from './observation.ts';

export type Read<Value> = { readonly value: Value } | { readonly refused: string };

const mostIdCharacters = 200;

const mostTextCharacters = 200;

const mostDaysBack = 400;

const anInstantWithAnOffset = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u;

function charactersOf(text: string): number {
  return Array.from(text).length;
}

function cut(text: string): string {
  return Array.from(text).slice(0, mostTextCharacters).join('');
}

export function isRefused<Value>(read: Read<Value>): read is { readonly refused: string } {
  return 'refused' in read;
}

function idTextOf(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  return typeof value === 'string' ? value : undefined;
}

export function perIdAt(item: unknown, pointer: string): Read<string> | 'none' {
  const resolved = resolvedAt(item, pointer);
  if (!resolved.found || resolved.value === null) {
    return 'none';
  }
  const id = idTextOf(resolved.value);
  return id === undefined || charactersOf(id) === 0 || charactersOf(id) > mostIdCharacters
    ? { refused: `the id at ${pointer} is not text or a number of 1 to 200 characters` }
    : { value: id };
}

function finalAt(final: string | true | undefined, item: unknown): Read<boolean> {
  if (final === undefined || final === true) {
    return { value: final === true };
  }
  const resolved = resolvedAt(item, final);
  return resolved.found && typeof resolved.value === 'boolean'
    ? { value: resolved.value }
    : { refused: `final at ${final} is not true or false` };
}

function instantAt(pointer: string, item: unknown): Instant | undefined {
  const resolved = resolvedAt(item, pointer);
  if (!resolved.found || typeof resolved.value !== 'string' || !anInstantWithAnOffset.test(resolved.value)) {
    return undefined;
  }
  const instant = Date.parse(resolved.value);
  return Number.isFinite(instant) ? instant : undefined;
}

function asOfAt(asOf: string | undefined, item: unknown, endedAt: Instant): Read<Instant> {
  if (asOf === undefined) {
    return { value: endedAt };
  }
  const instant = instantAt(asOf, item);
  if (instant === undefined) {
    return { refused: `as_of at ${asOf} is not an instant with an offset` };
  }
  if (instant > endedAt) {
    return { refused: `as_of at ${asOf} lies after the run ended` };
  }
  return instant < endedAt - mostDaysBack * aDay
    ? { refused: `as_of at ${asOf} lies more than 400 days before the run ended` }
    : { value: instant };
}

export function measurementAt(
  entry: EntryRule,
  item: unknown,
  endedAt: Instant,
): Read<ObservedMeasurement | undefined> {
  if (entry.measures === undefined) {
    return { value: undefined };
  }
  const resolved = resolvedAt(item, entry.measures);
  if (!resolved.found || typeof resolved.value !== 'number' || !Number.isFinite(resolved.value)) {
    return { refused: `the measure at ${entry.measures} is not a finite number` };
  }
  const final = finalAt(entry.final, item);
  const asOf = asOfAt(entry.as_of, item, endedAt);
  if (isRefused(final)) {
    return final;
  }
  return isRefused(asOf) ? asOf : { value: { value: resolved.value, final: final.value, as_of: asOf.value } };
}

export function saysAt(says: string | undefined, item: unknown): Read<string | undefined> {
  if (says === undefined) {
    return { value: undefined };
  }
  const resolved = resolvedAt(item, says);
  if (!resolved.found) {
    return { value: undefined };
  }
  return typeof resolved.value === 'string'
    ? { value: cut(resolved.value) }
    : { refused: `says at ${says} is not text` };
}

export function textAt(pointer: string | undefined, item: unknown): string | undefined {
  const resolved = pointer === undefined ? undefined : resolvedAt(item, pointer);
  return resolved?.found === true && typeof resolved.value === 'string' ? cut(resolved.value) : undefined;
}
