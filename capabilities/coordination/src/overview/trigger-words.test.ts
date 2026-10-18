import { plainTextOf, type Phrases } from '@on.auto/definitions';
import { describe, expect, it } from 'vitest';

import { summaryOf } from '../document/workflow-summary.ts';
import { workflow } from '../testing/workflows.ts';
import { cronInWords } from './cron-words.ts';
import { startsOf } from './trigger-words.ts';

function startsIn(schedule: string) {
  return startsOf(summaryOf(workflow(`schedule:\n${schedule}\ndo: []`)).triggers ?? []);
}

const eventSchedule = [
  '  on:',
  '    any:',
  '      - with: { type: com.example.brief.submitted, data: \'${ $data.priority === "high" }\' }',
  '      - with: { type: run_succeeded, subject: reasoning/summarize, depth: 2 }',
  '      - with: { type: com.example.brief.closed, data: { closed: true } }',
].join('\n');

function plainOf(phrases: Phrases): string {
  return phrases
    .map((phrase) => {
      if (typeof phrase === 'string') {
        return phrase;
      }
      return 'name' in phrase ? `**${phrase.name}**` : `\`${plainTextOf([phrase])}\``;
    })
    .join('');
}

describe('the words of an event trigger', () => {
  it('say each of its filters in the words of an event filter, with what each tests, an event at a time', () => {
    expect(startsIn(eventSchedule).map(({ label, words }) => [label, plainOf(words)])).toEqual([
      [
        'On com.example.brief.submitted, run_succeeded, or com.example.brief.closed',
        [
          'On an event, each time an event `com.example.brief.submitted` is published to the playbook, when `$data.priority === "high"` holds for its data,',
          'each time a run of the reasoning function **summarize** succeeds, when its `depth` is `2`,',
          'or each time an event `com.example.brief.closed` is published to the playbook, when its data is exactly `{"closed":true}`',
        ].join(' '),
      ],
      ['By a call', 'By a call of `run_definition`, from a caller or from a step of another workflow'],
    ]);
  });
});

describe('the words of each way a workflow starts', () => {
  it('say an event of a type alone, a cron schedule in words where it reads plainly, else as written, and an every', () => {
    const [ping, plain, every] = startsIn(
      "  on: { one: { with: { type: com.example.ping } } }\n  cron: '30 18 * * *'\n  every: { hours: 1, minutes: 30 }",
    );
    const [written] = startsIn("  cron: '*/5 * * * *'");

    expect([ping, plain, every, written]).toEqual([
      {
        label: 'On com.example.ping',
        words: [
          'On an event, ',
          'each time ',
          'an event ',
          { code: 'com.example.ping' },
          ' is published to the playbook',
        ],
      },
      { label: 'At 18:30 UTC every day', words: ['On a schedule, at 18:30 UTC every day'] },
      {
        label: 'Every 1 hour and 30 minutes',
        words: ['Every 1 hour and 30 minutes, counted from when the trigger was saved'],
      },
      {
        label: 'On the schedule */5 * * * *',
        words: ['On the cron schedule ', { code: '*/5 * * * *' }, ', read in UTC'],
      },
    ]);
  });

  it('end with a call, the one way a workflow without a schedule starts', () => {
    expect(startsOf([])).toEqual([
      {
        label: 'By a call',
        words: ['By a call of ', { code: 'run_definition' }, ', from a caller or from a step of another workflow'],
      },
    ]);
  });
});

describe('a cron schedule in words', () => {
  it('names the time in UTC and the days, a day of the week, a range, a list or a day of the month', () => {
    expect(
      ['0 9 * * 1-5', '0 7 * * 1', '0 7 * * 0', '0 7 * * 7', '0 7 * * 1,3,5', '0 0 1 * *', ' 5 23 * * * '].map((cron) =>
        cronInWords(cron),
      ),
    ).toEqual([
      'at 09:00 UTC from Monday to Friday',
      'at 07:00 UTC every Monday',
      'at 07:00 UTC every Sunday',
      'at 07:00 UTC every Sunday',
      'at 07:00 UTC on Monday, Wednesday, and Friday',
      'at 00:00 UTC on day 1 of each month',
      'at 23:05 UTC every day',
    ]);
  });

  it('reads no words of a schedule that does not read plainly', () => {
    expect(
      [
        '*/5 * * * *',
        '0 */2 * * *',
        '60 9 * * *',
        '0 24 * * *',
        '0 9 * 1 *',
        '0 9 1 * 1',
        '0 9 32 * *',
        '0 9 * * 5-1',
        '0 9 * * 1-8',
        '0 9 * * 1,9',
        '0 9 * * MON',
        '0 9 *',
        '0 9 * * * 2026',
      ].map((cron) => cronInWords(cron)),
    ).toEqual(Array.from({ length: 13 }));
  });
});
