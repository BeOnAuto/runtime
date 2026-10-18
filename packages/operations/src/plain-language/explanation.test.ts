import { describe, expect, it } from 'vitest';

import {
  explanationOf,
  refusalInWords,
  rejected,
  unsuccessfulWords,
  type CancelledKind,
  type ConflictKind,
  type ExplainedRejection,
  type OperationKind,
  type RejectionReason,
} from '../index.ts';

const correctable = 'This can be corrected and tried again; the details below say what to change.';

const operator =
  'Only whoever runs the server can put this right, so there is nothing to change on your side; once they have, it can be tried again. Meanwhile, everything that does not need it still works.';

const byReason: ReadonlyArray<readonly [Exclude<RejectionReason, 'conflict'>, string, string]> = [
  ['invalid_input', 'what was given does not fit what it needs', correctable],
  ['unavailable', 'something the server relies on is not available right now', operator],
  [
    'not_found',
    'it, or something it refers to, could not be found',
    'Check the names used; the details below say what is missing.',
  ],
  ['forbidden', 'this connection is not allowed to do that', 'Whoever set up this connection can allow it.'],
];

const byConflict: ReadonlyArray<readonly [ConflictKind, string, string]> = [
  ['taken', 'that name is already taken', 'A different name will work.'],
  ['retired', 'it has been retired', 'What is retired stays retired; a new one can be made under another name.'],
  ['concurrent_change', 'something else changed it at the same moment', 'Trying again should work.'],
  ['unworkable', 'it cannot work as it is written', correctable],
  [
    'stalled',
    'what it keeps of the playbook’s history stopped at a recorded event it could not take in',
    'It answers again once a corrected version is saved, which builds it anew from the history; the details below say which event stopped it and why.',
  ],
  [
    'oversized',
    'its result is larger than a run may record',
    'This can be put right on your side: once its result keeps only what is needed, such as fewer or smaller values, it can be run again.',
  ],
];

const ranUntilCancelled =
  'Nothing more of it runs, but what it did before may have changed something; start a new run if it is still needed.';

const byCancellation: ReadonlyArray<readonly [CancelledKind, string, string]> = [
  ['requested', 'it was cancelled at the request of someone allowed to change the playbook', ranUntilCancelled],
  [
    'deadline',
    'the step that waited for it ran out of time, so it was cancelled',
    'Nothing more of it runs, but what it did before may have changed something; the step that waited for it decides what happens next.',
  ],
  [
    'overrun',
    'it ran for as long as a workflow may run, so it was stopped',
    'Whoever runs the server decides how long a workflow may run; what it did before may have changed something, so check before starting a new run.',
  ],
  [
    'parent_ended',
    'the run that waited for it ended first, so it was cancelled',
    'Nothing more of it runs, since only that run needed it; what it did before may have changed something.',
  ],
];

const calledToolsWords =
  'Could not run the reasoning function “summary”: this run calls tools, and an attempt of it under the same id may still be in progress or did not succeed, so its tools may have changed something. So it was not run again: start a new run instead, after checking what its history shows it has called so far.';

describe('the explanation of a view still being built', () => {
  it('says that trying again later should work, and that nothing needs to change', () => {
    expect(explanationOf({ reason: 'unavailable', kind: 'rebuilding' })).toEqual({
      why: 'what it keeps of the playbook’s history is still being built from that history',
      remedy: 'Nothing needs to change: trying again in a little while should work.',
    });
  });
});

const switchable =
  'This can be put right on your side: once its prompt names one of the models this server can call, which list_models shows, it can be tried again.';

const notOffered: ReadonlyArray<readonly [string, ExplainedRejection, string]> = [
  [
    'without saying why',
    { reason: 'unavailable', kind: 'model_not_offered' },
    'this server does not offer the model named',
  ],
  [
    'because its provider is not set up',
    { reason: 'unavailable', kind: 'model_not_offered', because: 'provider_not_configured' },
    'this server does not offer the model named, because its provider is not set up on this server, though others are',
  ],
  [
    'because it is not allowed',
    { reason: 'unavailable', kind: 'model_not_offered', because: 'model_not_allowed' },
    'this server does not offer the model named, because it is not among the models whoever runs the server allows',
  ],
];

const afterStopping: ReadonlyArray<readonly [OperationKind, string]> = [
  ['command', 'It may or may not have taken effect, so check before trying again.'],
  ['query', 'It can be tried again once the server is back.'],
];

describe('the words of a refusal', () => {
  it('say what each reason did to a run in plain words, and no code', () => {
    expect(
      ['invalid_input', 'unavailable', 'not_found', 'forbidden', 'conflict', 'cancelled', 'unanswered', 'teapot'].map(
        (reason) => refusalInWords(reason),
      ),
    ).toEqual([
      'refused its input',
      'was not available',
      'could not be found',
      'was not allowed',
      'could not go through',
      'was cancelled',
      'went unanswered',
      'did not go through',
    ]);
  });
});

describe('explanationOf', () => {
  it.each(byReason)('explains %s', (reason, why, remedy) => {
    expect(explanationOf({ reason })).toEqual({ why, remedy });
  });

  it('explains an input the input schema of what it runs refused in the words of any input it did not take', () => {
    expect(explanationOf({ reason: 'invalid_input', kind: 'input_schema' })).toEqual(
      explanationOf({ reason: 'invalid_input' }),
    );
  });

  it.each(byConflict)('explains a conflict of the kind %s', (kind, why, remedy) => {
    expect(explanationOf({ reason: 'conflict', kind })).toEqual({ why, remedy });
  });

  it.each(notOffered)('explains a model the server does not offer, %s', (_case, rejection, why) => {
    expect(explanationOf(rejection)).toEqual({ why, remedy: switchable });
  });

  it('explains a run refused under its id, whose tools may have changed something', () => {
    expect(explanationOf({ reason: 'conflict', kind: 'tools_called' })).toEqual({
      why: 'this run calls tools, and an attempt of it under the same id may still be in progress or did not succeed, so its tools may have changed something',
      remedy:
        'So it was not run again: start a new run instead, after checking what its history shows it has called so far.',
      mayHaveChanged: true,
    });
  });

  it.each(byCancellation)(
    'explains a run cancelled with the kind %s, which may have changed something',
    (kind, why, remedy) => {
      expect(explanationOf({ reason: 'cancelled', kind })).toEqual({ why, remedy, mayHaveChanged: true });
    },
  );
});

describe('explanationOf a run that names no kind', () => {
  it('explains a cancelled run that does not say its kind', () => {
    expect(explanationOf({ reason: 'cancelled' })).toEqual({
      why: 'it was cancelled before it finished',
      remedy: 'Nothing more of it runs; start a new run if it is still needed.',
      mayHaveChanged: true,
    });
  });

  it('explains a conflict that does not say its kind', () => {
    expect(explanationOf({ reason: 'conflict' })).toEqual({
      why: 'it clashes with something already there',
      remedy: 'The details below say what is in the way.',
    });
  });
});

describe('unsuccessfulWords of a run whose tools only read', () => {
  it('says that nothing changed', () => {
    expect(
      unsuccessfulWords('run the reasoning function “summary”', 'command', {
        ...rejected('unavailable', 'x', undefined, 'tools_unfinished'),
        because: 'run_bound',
      }),
    ).toBe(
      "Could not run the reasoning function “summary”: it called tools but could not finish, because it ran out of time. Nothing was changed. Every tool it called only reads, by its server's own account, so running it again is safe: a new run, or a workflow's retry, may make it; its history shows what it called.",
    );
  });
});

describe('unsuccessfulWords', () => {
  it('says what could not be done, why, that nothing changed, and what to do, for a command', () => {
    expect(
      unsuccessfulWords('create the playbook “Sales”', 'command', rejected('conflict', 'x', undefined, 'taken')),
    ).toBe(
      'Could not create the playbook “Sales”: that name is already taken. Nothing was changed. A different name will work.',
    );
  });

  it('does not say that nothing changed for a command whose tool calls may have changed something', () => {
    expect(
      unsuccessfulWords('run the reasoning function “summary”', 'command', {
        ...rejected('conflict', 'x', undefined, 'effect_unknown'),
        because: 'run_bound',
      }),
    ).toBe(
      'Could not run the reasoning function “summary”: it could not finish after calling a tool that may change something, so whether that happened is not known, because it ran out of time. It is not run again by itself: a person decides, or a workflow rule that names this kind; its history shows the call.',
    );
  });

  it('does not say that nothing changed for a run that was cancelled, since it may have done some of its work', () => {
    expect(
      unsuccessfulWords('run the workflow “close”', 'command', rejected('cancelled', 'x', undefined, 'deadline')),
    ).toBe(
      'Could not run the workflow “close”: the step that waited for it ran out of time, so it was cancelled. Nothing more of it runs, but what it did before may have changed something; the step that waited for it decides what happens next.',
    );
  });

  it('does not say that nothing changed for a query, which changes nothing', () => {
    expect(unsuccessfulWords('look up the playbook “sales”', 'query', rejected('not_found', 'x'))).toBe(
      'Could not look up the playbook “sales”: it, or something it refers to, could not be found. Check the names used; the details below say what is missing.',
    );
  });

  it('gives the reference of an unexpected failure, and says it was not the person’s doing', () => {
    expect(
      unsuccessfulWords('run the reasoning function “summary”', 'command', { status: 'failed', incident: 'abc' }),
    ).toBe(
      'Could not run the reasoning function “summary”: something went wrong inside the server. It was not caused by anything you did. If it happens again, whoever runs the server can look into it with this reference: abc.',
    );
  });

  it.each(afterStopping)('says what to do after a %s the server stopped', (kind, next) => {
    expect(unsuccessfulWords('do it', kind, { status: 'cancelled' })).toBe(
      `Could not do it: the server stopped before it finished. ${next}`,
    );
  });
});

describe('unsuccessfulWords for a run refused under its id', () => {
  it('does not say that nothing changed, since the tools of the run may have changed something', () => {
    expect(
      unsuccessfulWords(
        'run the reasoning function “summary”',
        'command',
        rejected('conflict', 'x', undefined, 'tools_called'),
      ),
    ).toBe(calledToolsWords);
  });
});
