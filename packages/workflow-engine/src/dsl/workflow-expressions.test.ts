import { describe, expect, it } from 'vitest';

import type { Json, JsonObject } from './json.ts';
import { holdsAnExpression, workflowExpressionsOf } from './workflow-expressions.ts';

const header = { dsl: '1.0.0', namespace: 'playbook', name: 'publish-brief', version: '1.0.0' };

function placesOf(document: JsonObject): Readonly<Record<string, readonly [string, string]>> {
  return Object.fromEntries(
    workflowExpressionsOf(document).map(({ pointer, source, names }) => [pointer, [source, names.join(' ')]]),
  );
}

const task = '$data $context $workflow $runtime $task';

describe('the expressions of a workflow', () => {
  it('are found at the top of the document with the names its root binds', () => {
    expect(
      placesOf({
        document: header,
        input: { from: '$data.brief' },
        timeout: { after: '${ ({ minutes: $workflow.input.minutes }) }' },
        output: { as: { decision: '${ $context.decision }', fixed: 'kept', count: 2 } },
        do: [{ wait: { wait: { seconds: 1 } } }],
      }),
    ).toEqual({
      '/input/from': ['$data.brief', '$data $workflow $runtime'],
      '/timeout/after': [' ({ minutes: $workflow.input.minutes }) ', '$data $workflow $runtime'],
      '/output/as/decision': [' $context.decision ', '$data $workflow $runtime $context'],
    });
  });
});

describe('the expressions of a task', () => {
  it('are found in every part of it, each with the names its place binds', () => {
    expect(
      placesOf({
        document: header,
        do: [
          {
            review: {
              if: '$input.ready',
              timeout: { after: '${ $task.definition }' },
              input: { from: { brief: '${ $data.text }' } },
              call: 'reasoning',
              with: { name: 'review-brief', input: ['${ $input }'] },
              output: { as: '${ $data.review }' },
              export: { as: '${ ({ ...$context, review: $output }) }' },
            },
          },
          { pause: { wait: '${ ({ seconds: $context.delay }) }' } },
          { refuse: { raise: { error: { type: 'refused', status: 400, detail: '${ `refused ${$data.reason}` }' } } } },
          { tell: { emit: { event: { with: { type: 'brief.reviewed', data: '${ $context.review }' } } } } },
          { route: { switch: [{ approved: { when: '$data.verdict == "approve"' } }, { other: {} }] } },
          { hear: { listen: { to: { one: { with: { type: 'brief.edited', data: '${ $data.urgent }' } } } } } },
          { keep: { set: { verdict: '${ $data.verdict }' } } },
        ],
      }),
    ).toEqual({
      '/do/0/review/if': ['$input.ready', task],
      '/do/0/review/timeout/after': [' $task.definition ', task],
      '/do/0/review/input/from/brief': [' $data.text ', task],
      '/do/0/review/with/input/0': [' $input ', `${task} $input`],
      '/do/0/review/output/as': [' $data.review ', `${task} $input`],
      '/do/0/review/export/as': [' ({ ...$context, review: $output }) ', `${task} $input $output`],
      '/do/1/pause/wait': [' ({ seconds: $context.delay }) ', `${task} $input`],
      '/do/2/refuse/raise/error/detail': [' `refused ${$data.reason}` ', `${task} $input`],
      '/do/3/tell/emit/event/with/data': [' $context.review ', `${task} $input`],
      '/do/4/route/switch/0/approved/when': ['$data.verdict == "approve"', `${task} $input`],
      '/do/5/hear/listen/to/one/with/data': [' $data.urgent ', '$data'],
      '/do/6/keep/set/verdict': [' $data.verdict ', `${task} $input`],
    });
  });
});

describe('the expressions of the tasks a task holds', () => {
  it('bind the names a loop and a catch declare', () => {
    expect(
      placesOf({
        document: header,
        do: [
          {
            each: {
              for: { in: '$data.briefs', each: 'brief', at: 'position' },
              while: '$position < 10',
              do: [{ note: { set: { title: '${ $brief.title }' } } }],
            },
          },
          { plain: { for: { in: '$data.items' }, do: [{ seen: { set: { at: '${ $index }' } } }] } },
          {
            guarded: {
              try: [{ attempt: { set: { tried: '${ true }' } } }],
              catch: {
                as: 'failure',
                when: '$failure.status == 503',
                exceptWhen: '$failure.status == 400',
                retry: {
                  when: '$failure.retryable',
                  exceptWhen: '$input.final',
                  delay: '${ ({ seconds: 2 }) }',
                  limit: { attempt: { count: 3 } },
                },
                do: [{ recover: { set: { reason: '${ $failure.title }' } } }],
              },
            },
          },
          { named: { try: [{ again: { set: {} } }], catch: { retry: 'patient' } } },
        ],
      }),
    ).toEqual({
      '/do/0/each/for/in': ['$data.briefs', `${task} $input`],
      '/do/0/each/while': ['$position < 10', `$brief $position ${task} $input`],
      '/do/0/each/do/0/note/set/title': [' $brief.title ', `$brief $position ${task} $input`],
      '/do/1/plain/for/in': ['$data.items', `${task} $input`],
      '/do/1/plain/do/0/seen/set/at': [' $index ', `$item $index ${task} $input`],
      '/do/2/guarded/catch/when': ['$failure.status == 503', `${task} $input $failure`],
      '/do/2/guarded/catch/exceptWhen': ['$failure.status == 400', `${task} $input $failure`],
      '/do/2/guarded/catch/retry/when': ['$failure.retryable', `${task} $input $failure`],
      '/do/2/guarded/catch/retry/exceptWhen': ['$input.final', `${task} $input $failure`],
      '/do/2/guarded/catch/retry/delay': [' ({ seconds: 2 }) ', `${task} $input $failure`],
      '/do/2/guarded/try/0/attempt/set/tried': [' true ', `${task} $input`],
      '/do/2/guarded/catch/do/0/recover/set/reason': [' $failure.title ', `$failure ${task} $input`],
    });
  });
});

describe('the expressions of branches', () => {
  it('are found in the branches of a fork and in the tasks a do holds', () => {
    expect(
      placesOf({
        document: header,
        do: [
          { both: { fork: { branches: [{ left: { set: { side: '${ "left" }' } } }] } } },
          { inner: { do: [{ deeper: { set: { depth: '${ $task.name }' } } }] } },
        ],
      }),
    ).toEqual({
      '/do/0/both/fork/branches/0/left/set/side': [' "left" ', `${task} $input`],
      '/do/1/inner/do/0/deeper/set/depth': [' $task.name ', `${task} $input`],
    });
  });
});

describe('the expressions a workflow shares', () => {
  it('are found in the shared retries, timeouts and errors, with every name any task may bind', () => {
    const shared = placesOf({
      document: header,
      use: {
        retries: {
          patient: { when: '$error.status == 503', jitter: { from: '${ ({ seconds: 1 }) }' } },
          fixed: 'not a policy',
        },
        timeouts: { short: { after: '${ ({ seconds: $context.seconds }) }' } },
        errors: { refused: { type: 'refused', status: '${ 400 }' } },
      },
      do: [{ loop: { for: { in: '$data', each: 'row' }, do: [] } }, { guard: { try: [], catch: { as: 'fault' } } }],
    });

    expect(Object.keys(shared)).toEqual([
      '/use/retries/patient/when',
      '/use/retries/patient/jitter/from',
      '/use/timeouts/short/after',
      '/use/errors/refused/status',
      '/do/0/loop/for/in',
    ]);
    expect(shared['/use/retries/patient/when']?.[1]).toBe(
      '$data $context $workflow $runtime $task $input $output $item $index $error $row $fault',
    );
  });
});

describe('the expressions of filters', () => {
  it('are found in the filters of a schedule, over $data alone', () => {
    expect(
      placesOf({
        document: header,
        schedule: { on: { any: [{ with: { type: 'brief.created', data: '${ $data.urgent }' } }, 'not a filter'] } },
        do: [{ hear: { listen: { to: { all: ['not a filter'] } } } }],
      }),
    ).toEqual({ '/schedule/on/any/0/with/data': [' $data.urgent ', '$data'] });
  });

  it('skip a switch whose cases are not objects, a loop that is not one and a try that catches nothing', () => {
    expect(
      placesOf({
        document: header,
        do: [
          { route: { switch: ['loose', { odd: 'case' }] } },
          { loose: { for: 'rows', do: [{ seen: { set: { at: '${ $index }' } } }] } },
          { bare: { try: [{ attempt: { set: { tried: '${ $input }' } } }] } },
        ],
      }),
    ).toEqual({
      '/do/1/loose/do/0/seen/set/at': [' $index ', `$item $index ${task} $input`],
      '/do/2/bare/try/0/attempt/set/tried': [' $input ', `${task} $input`],
    });
  });
});

const written: readonly Json[] = [
  'Spring',
  '${ $data.name }',
  [1, 'two', { three: 3 }],
  [1, { more: ['${ $data.next }'] }],
  { items: [{ name: '${ $data }' }] },
  null,
];

describe('a value written into a workflow', () => {
  it('holds an expression when any string within it, at any depth, is one', () => {
    expect(written.map((value) => holdsAnExpression(value))).toEqual([false, true, false, true, true, false]);
  });
});
