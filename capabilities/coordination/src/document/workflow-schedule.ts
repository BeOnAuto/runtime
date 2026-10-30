import type { Trigger, TriggerFilter } from '@on.auto/definitions';
import {
  field,
  forbidden,
  isObject,
  type Json,
  type JsonObject,
  literalFilterOf,
  pointerTo,
  readDuration,
  type Rejection,
  rejection,
  textField,
} from '@on.auto/workflow-engine';
import { cronRejectionOf, isKnownTimeZone } from '@on.auto/workflow-host';
import { Schema } from 'effect';

type Kind = 'on' | 'cron' | 'every';

interface CronZone {
  readonly time_zone?: string;
}

const kinds: readonly Kind[] = ['on', 'cron', 'every'];

const timeZoneKey = 'time_zone';

const scheduleKeys: ReadonlySet<string> = new Set([...kinds, 'after', timeZoneKey]);

export const mostTriggerFilters = 64;

const shortestPeriodMs = 60_000;

const scheduleTakes = 'schedule is a mapping that names the triggers of the workflow: on, cron and every';

const noTrigger = 'A schedule names at least one trigger: on, cron or every, each at most once';

const afterRefused =
  'A workflow is not started again after its run ends: give it a trigger with on, cron or every instead';

const allRefused =
  'A trigger starts a run for every event that matches it, so it takes one or any; all, which waits for several events, is for a listen task';

const untilRefused = 'A trigger matches every event of its playbook while its version is active, so it takes no until';

const onTakes = 'on takes one, a filter of the events that start the workflow, or any, a list of at least one';

const tooManyFilters = `A trigger takes at most ${mostTriggerFilters} filters, since each is matched against every event of a type it names for as long as its version is active`;

const timeZoneTakes = 'time_zone expects an IANA time zone name such as Europe/London';

const timeZoneWithoutCron =
  'time_zone is the time zone of cron, so a schedule without cron takes none; every counts a period, which has no time zone';

const sameAttributes = Schema.toEquivalence(Schema.JsonObject);

interface PlacedFilter {
  readonly filter: Json;
  readonly place: string;
}

function isKind(key: string): key is Kind {
  return kinds.some((kind) => kind === key);
}

function filterRejections(filter: Json, pointer: string): readonly Rejection[] {
  const reading = literalFilterOf(filter, pointer);
  return 'rejections' in reading ? reading.rejections : [];
}

function filtersOf(on: JsonObject): readonly PlacedFilter[] {
  const one = field(on, 'one');
  const any = field(on, 'any');
  if (one !== undefined) {
    return [{ filter: one, place: '/one' }];
  }
  return Array.isArray(any) ? any.map((filter: Json, index): PlacedFilter => ({ filter, place: `/any/${index}` })) : [];
}

function triggerFiltersOf(on: JsonObject, pointer: string): readonly TriggerFilter[] {
  return filtersOf(on).flatMap(({ filter, place }): readonly TriggerFilter[] => {
    const reading = literalFilterOf(filter, `${pointer}${place}`);
    if ('rejections' in reading) {
      return [];
    }
    const { reference, type, attributes } = reading.filter;
    return [{ reference, type, attributes }];
  });
}

function isSameFilter(first: TriggerFilter, second: TriggerFilter): boolean {
  return first.type === second.type && sameAttributes(first.attributes, second.attributes);
}

function repeatedRejections(filters: readonly TriggerFilter[]): readonly Rejection[] {
  return filters.flatMap((filter, index) => {
    const first = filters.slice(0, index).find((earlier) => isSameFilter(earlier, filter));
    return first === undefined
      ? []
      : [rejection(filter.reference, `This filter takes the same events as the one at ${first.reference}`)];
  });
}

function boundRejections(on: JsonObject, pointer: string): readonly Rejection[] {
  return filtersOf(on).length > mostTriggerFilters ? [rejection(`${pointer}/any`, tooManyFilters)] : [];
}

function onRejections(on: Json, pointer: string): readonly Rejection[] {
  if (!isObject(on)) {
    return [rejection(pointer, onTakes)];
  }
  if (field(on, 'all') !== undefined) {
    return [forbidden(`${pointer}/all`, allRefused)];
  }
  const until = field(on, 'until') === undefined ? [] : [forbidden(`${pointer}/until`, untilRefused)];
  const filters = filtersOf(on);
  const empty = filters.length === 0 ? [rejection(pointer, onTakes)] : [];
  return until.concat(
    empty,
    boundRejections(on, pointer),
    filters.flatMap(({ filter, place }) => filterRejections(filter, `${pointer}${place}`)),
    repeatedRejections(triggerFiltersOf(on, pointer)),
  );
}

function cronRejections(cron: Json, pointer: string): readonly Rejection[] {
  if (typeof cron !== 'string') {
    return [rejection(pointer, 'cron is text of five fields, minute, hour, day of month, month and day of week')];
  }
  const refusal = cronRejectionOf(cron);
  return refusal === undefined ? [] : [rejection(pointer, refusal)];
}

function everyRejections(every: Json, pointer: string): readonly Rejection[] {
  const reading = readDuration(every);
  if ('problem' in reading) {
    return [rejection(pointer, reading.problem)];
  }
  return reading.milliseconds < shortestPeriodMs
    ? [rejection(pointer, `A schedule is due at most once a minute, not every ${reading.milliseconds} ms`)]
    : [];
}

const kindRejections: Readonly<Record<Kind, (value: Json, pointer: string) => readonly Rejection[]>> = {
  on: onRejections,
  cron: cronRejections,
  every: everyRejections,
};

function isKindEntry(entry: readonly [string, Json]): entry is readonly [Kind, Json] {
  return isKind(entry[0]);
}

function timeZoneRejections(schedule: JsonObject, pointer: string): readonly Rejection[] {
  const timeZone = field(schedule, timeZoneKey);
  if (timeZone === undefined) {
    return [];
  }
  const place = pointerTo(pointer, timeZoneKey);
  if (field(schedule, 'cron') === undefined) {
    return [rejection(place, timeZoneWithoutCron)];
  }
  return typeof timeZone === 'string' && isKnownTimeZone(timeZone)
    ? []
    : [rejection(place, `${timeZoneTakes}, not ${JSON.stringify(timeZone)}`)];
}

export function scheduleRejections(schedule: Json, pointer: string): readonly Rejection[] {
  if (!isObject(schedule)) {
    return [rejection(pointer, scheduleTakes)];
  }
  const entries: readonly (readonly [string, Json])[] = Object.entries(schedule);
  const named = entries.filter((entry: readonly [string, Json]) => isKindEntry(entry));
  const after = field(schedule, 'after') === undefined ? [] : [forbidden(`${pointer}/after`, afterRefused)];
  const unknown = entries
    .filter(([key]: readonly [string, Json]) => !scheduleKeys.has(key))
    .map(([key]: readonly [string, Json]) =>
      rejection(pointerTo(pointer, key), `schedule takes on, cron, every and time_zone, not ${key}`),
    );
  const none = named.length > 0 || after.length > 0 ? [] : [rejection(pointer, noTrigger)];
  return after.concat(
    unknown,
    none,
    named.flatMap(([kind, value]: readonly [Kind, Json]) => kindRejections[kind](value, pointerTo(pointer, kind))),
    timeZoneRejections(schedule, pointer),
  );
}

function triggerOf([key, value]: readonly [string, Json], zone: CronZone): readonly Trigger[] {
  const reference = pointerTo('/schedule', key);
  if (key === 'on' && isObject(value)) {
    return [{ kind: 'event', reference, filters: triggerFiltersOf(value, reference) }];
  }
  if (key === 'cron' && typeof value === 'string') {
    return [{ kind: 'cron', reference, expression: value, ...zone }];
  }
  if (key !== 'every') {
    return [];
  }
  const every = readDuration(value);
  return 'milliseconds' in every ? [{ kind: 'every', reference, milliseconds: every.milliseconds }] : [];
}

function cronZoneOf(schedule: JsonObject): CronZone {
  const timeZone = textField(schedule, timeZoneKey);
  return timeZone === undefined ? {} : { time_zone: timeZone };
}

export function triggersOfDocument(document: JsonObject): readonly Trigger[] {
  const schedule = field(document, 'schedule');
  if (!isObject(schedule)) {
    return [];
  }
  const zone = cronZoneOf(schedule);
  return Object.entries(schedule).flatMap((entry: readonly [string, Json]) => triggerOf(entry, zone));
}
