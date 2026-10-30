import { PlaybookReader, defineHttpOperation } from '@on.auto/operations';
import { Clock, Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities, type KnownCapabilities } from '../capability/known-capabilities.ts';
import { RunsOfNameField } from '../operations/definition-fields.ts';
import { analyticsOf, PlaybookAnalyticsSchema } from './analytics-answer.ts';
import { DaysField, dayFieldOf, dayOf, longestWindowInDays, windowOf } from './analytics-window.ts';

const description = [
  'Counts what the runs of the playbook did over a window of days in UTC: how many succeeded, failed or were rejected,',
  'the tokens their models used, and how long they took at the median and the 95th percentile,',
  'for the window, for each day of it and for each definition.',
  'Use it when the person asks how the playbook is doing; list_runs lists the runs themselves.',
  '`days` reads the last 7, 14 or 30 days, or `from` and `to` the days between them, and `type` and `name` keep the runs of one definition.',
].join(' ');

function analyticsInputOf(typeField: KnownCapabilities['field']) {
  return Schema.Struct({
    days: Schema.optionalKey(DaysField),
    from: Schema.optionalKey(dayFieldOf('The first day to read, YYYY-MM-DD in UTC, given with to and not with days')),
    to: Schema.optionalKey(
      dayFieldOf(
        `The last day to read, YYYY-MM-DD in UTC, no later than today and at most ${longestWindowInDays} days from the first`,
      ),
    ),
    type: Schema.optionalKey(typeField),
    name: Schema.optionalKey(RunsOfNameField),
  });
}

type AnalyticsInput = ReturnType<typeof analyticsInputOf>['Type'];

function selectionOf({ type, name }: AnalyticsInput) {
  return { ...(type === undefined ? {} : { definitionType: type }), ...(name === undefined ? {} : { name }) };
}

const readAnalytics = Effect.fnUntraced(function* (input: AnalyticsInput) {
  const window = yield* windowOf(input, dayOf(yield* Clock.currentTimeMillis));
  const groups = yield* (yield* PlaybookReader).readRunOutcomes(
    { from: window.from, to: window.to },
    selectionOf(input),
  );
  return analyticsOf(window, groups);
});

export function defineGetPlaybookAnalytics(capabilities: readonly Capability[]) {
  const known = knownCapabilities(capabilities);
  const operation = defineHttpOperation('playbook', 'query', {
    name: 'get_playbook_analytics',
    title: 'Get playbook analytics',
    description,
    route: { method: 'GET', path: '/analytics' },
    body: { kind: 'none' },
    inputSchema: analyticsInputOf(known.field),
    answer: { kind: 'json', outputSchema: PlaybookAnalyticsSchema },
    reasons: ['invalid_input'],
    handle: readAnalytics,
  });
  return known.publish(operation, 'Only the runs of this type');
}
