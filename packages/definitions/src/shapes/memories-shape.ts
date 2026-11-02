import type { SchemaIssue } from '@on.auto/json-schema';
import type { Schema } from 'effect';

import { charactersIn } from '../plain-language/characters.ts';
import { closedRecord, shapeOf, type OutputShape } from './output-shape.ts';
import { isADayOfTheCalendar } from './period-forms.ts';
import { counted, issueAt, itemsOf, recordOf, textValue } from './shape-values.ts';

export const memoriesBounds = {
  leastTextCharacters: 1,
  mostTextCharacters: 2000,
  mostTags: 8,
  tagPattern: '^[a-z0-9][a-z0-9-]{0,31}$',
  mostRecalledCharacters: 16_000,
} as const;

const date: Schema.JsonObject = { type: 'string', minLength: 10, maxLength: 10, description: 'A day, as YYYY-MM-DD' };

const tagPattern = new RegExp(memoriesBounds.tagPattern, 'u');

const memory = closedRecord(
  {
    id: { type: 'string', minLength: 1, description: 'The id of the memory' },
    scope: { type: 'string', enum: ['playbook', 'organization'], description: 'Where the memory is kept' },
    text: {
      type: 'string',
      minLength: memoriesBounds.leastTextCharacters,
      maxLength: memoriesBounds.mostTextCharacters,
      description: 'What was remembered',
    },
    tags: {
      type: 'array',
      maxItems: memoriesBounds.mostTags,
      items: { type: 'string', minLength: 1, maxLength: 32 },
      description: 'The tags of the memory',
    },
    about: closedRecord({ from: date, to: date }, ['from', 'to']),
    written_at: { type: 'string', minLength: 1, description: 'When the memory was written, in ISO 8601' },
    written_by: { type: 'string', minLength: 1, description: 'Who wrote the memory' },
  },
  ['id', 'scope', 'text', 'tags', 'written_at', 'written_by'],
);

function charactersOf(entry: Schema.Json): number {
  return charactersIn(textValue(recordOf(entry)['text']) ?? '');
}

function charactersIssues(memories: readonly Schema.Json[]): readonly SchemaIssue[] {
  const characters = memories.reduce<number>((total, entry) => total + charactersOf(entry), 0);
  return characters > memoriesBounds.mostRecalledCharacters
    ? [
        issueAt(
          ['memories'],
          `Expected at most ${counted.format(memoriesBounds.mostRecalledCharacters)} characters of text across the memories`,
        ),
      ]
    : [];
}

function tagIssues(entry: Schema.Json, index: number): readonly SchemaIssue[] {
  return itemsOf(recordOf(entry)['tags']).flatMap((tag, at) => {
    const text = textValue(tag);
    return text === undefined || tagPattern.test(text)
      ? []
      : [
          issueAt(
            ['memories', index, 'tags', at],
            'Expected lowercase letters, digits and hyphens, starting with a letter or a digit',
          ),
        ];
  });
}

function dayIssues(about: Schema.JsonObject, path: readonly (string | number)[]): readonly SchemaIssue[] {
  return ['from', 'to'].flatMap((end) => {
    const day = textValue(about[end]);
    return day === undefined || isADayOfTheCalendar(day)
      ? []
      : [issueAt([...path, end], 'Expected a day of the calendar')];
  });
}

function aboutIssues(entry: Schema.Json, index: number): readonly SchemaIssue[] {
  const about = recordOf(recordOf(entry)['about']);
  const path = ['memories', index, 'about'];
  const days = dayIssues(about, path);
  const from = textValue(about['from']);
  const to = textValue(about['to']);
  if (days.length > 0 || from === undefined || to === undefined) {
    return days;
  }
  return from <= to ? [] : [issueAt([...path, 'to'], 'Expected a day no earlier than from')];
}

function memoriesIssues(value: Schema.Json): readonly SchemaIssue[] {
  const memories = itemsOf(recordOf(value)['memories']);
  return [
    ...charactersIssues(memories),
    ...memories.flatMap((entry, index) => tagIssues(entry, index).concat(aboutIssues(entry, index))),
  ];
}

export const memoriesShape: OutputShape = shapeOf({
  name: 'memories',
  properties: {
    memories: {
      type: 'array',
      items: memory,
      maxItems: memoriesBounds.mostRecalledCharacters,
      description: 'The memories recalled, newest first',
    },
  },
  required: ['memories'],
  further: memoriesIssues,
});
