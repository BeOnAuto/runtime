import { Effect, Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { renderClock } from '../template/render-clock.ts';
import { glanceOf, glanceShown, mostGlanceBytes } from './page-glance.ts';

const clock = Effect.runSync(renderClock);

const at = { lineAt: () => 7, views: { done: 'categories' as const } };

function parsed(value: Schema.JsonObject) {
  return Result.getOrThrow(glanceOf(value, at));
}

function shown(value: Schema.JsonObject, variables: Readonly<Record<string, Schema.Json>> = {}) {
  return glanceShown(parsed(value), {
    variables: {
      views: { done: { values: [{ name: 'A', value: 2 }] } },
      output: { blockers: ['Authorize'] },
      ...variables,
    },
    clock,
  });
}

function issuesOf(check: () => ReturnType<typeof glanceOf>): readonly string[] {
  return Result.match(check(), {
    onSuccess: () => [],
    onFailure: (issues) => issues.map(({ line, pointer }) => `${line} ${pointer}`),
  });
}

function detailsOf(check: () => ReturnType<typeof glanceOf>): readonly string[] {
  return Result.match(check(), { onSuccess: () => [], onFailure: (issues) => issues.map(({ detail }) => detail) });
}

describe('a glance as written', () => {
  it('keeps numbers, nulls and lists, and reads each string as a template', () => {
    expect(
      shown({
        headline: '{{ views.done.values | size }} done.',
        visual: {
          kind: 'figures',
          items: [
            { name: 'Done', value: 2, limit: null },
            { name: 'Open', value: true },
          ],
        },
        outstanding: [{ kind: 'blocker', title: '{{ output.blockers[0] }}' }],
      }),
    ).toEqual({
      headline: '1 done.',
      visual: {
        kind: 'figures',
        items: [
          { name: 'Done', value: 2, limit: null },
          { name: 'Open', value: true },
        ],
      },
      outstanding: [{ kind: 'blocker', title: 'Authorize' }],
    });
  });

  it('reads a string that is one output alone as the JSON its text says, and any other as text', () => {
    expect(
      shown({
        count: '{{ views.done.values | size }}',
        points: '{{ views.done.values | json }}',
        word: '{{ output.blockers[0] }}',
        sentence: 'Count {{ views.done.values | size }}',
      }),
    ).toEqual({ count: 1, points: [{ name: 'A', value: 2 }], word: 'Authorize', sentence: 'Count 1' });
  });
});

describe('a glance refused', () => {
  it('names each template that reads what the glance does not have, under its own pointer and line', () => {
    expect(
      issuesOf(() => glanceOf({ headline: '{{ input.name }}', visual: { name: '{{ views.missing }}' } }, at)),
    ).toEqual(['7 /glance/headline', '7 /glance/visual/name']);
    expect(issuesOf(() => glanceOf({ items: ['{{ nope }}', 'fine'] }, at))).toEqual(['7 /glance/items/0']);
    expect(issuesOf(() => glanceOf({ headline: '{% if %}' }, at))).toEqual(['7 /glance/headline']);
  });

  it('is past 16 KiB as JSON', () => {
    expect(detailsOf(() => glanceOf({ headline: 'x'.repeat(mostGlanceBytes) }, at))).toEqual([
      `The glance takes ${mostGlanceBytes + 15} bytes as JSON, more than the ${mostGlanceBytes} it may take`,
    ]);
  });
});

describe('a glance rendered', () => {
  it('is none where a template stops, in a mapping or a list', () => {
    expect(shown({ headline: '{{ "dollars" | money }}' }, { output: null })).toBeUndefined();
    expect(shown({ items: ['{{ "dollars" | money }}'] }, { output: null })).toBeUndefined();
  });
});
