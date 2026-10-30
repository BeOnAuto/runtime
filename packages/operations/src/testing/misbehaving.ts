import { Effect, Schema } from 'effect';

import { Conflict, defineCommand, defineQuery, type DeclarableReason } from '../index.ts';

const Empty = Schema.Record(Schema.String, Schema.Never);

const noReasonsDeclared: readonly DeclarableReason[] = [];

export const explode = defineQuery('playbook', {
  name: 'explode',
  title: 'Explode',
  description: 'Fails with a defect that carries a secret.',
  route: { method: 'GET', path: '/explode' },
  inputSchema: Empty,
  outputSchema: Empty,
  reasons: [],
  handle: () => Effect.die(new Error('the store password is hunter2')),
});

export const breakAndGiveUp = defineQuery('playbook', {
  name: 'break_and_give_up',
  title: 'Break and give up',
  description: 'Interrupts itself, and a finalizer fails with a defect.',
  route: { method: 'GET', path: '/break-and-give-up' },
  inputSchema: Empty,
  outputSchema: Empty,
  reasons: [],
  handle: () =>
    Effect.interrupt.pipe(Effect.ensuring(Effect.die(new Error('broken beside an interruption'))), Effect.as({})),
});

export const breakOnceLeft = defineQuery('playbook', {
  name: 'break_once_left',
  title: 'Break once left',
  description: 'Waits forever, and fails with a defect once its caller has gone.',
  route: { method: 'GET', path: '/break-once-left' },
  inputSchema: Empty,
  outputSchema: Empty,
  reasons: [],
  handle: () =>
    Effect.never.pipe(
      Effect.onInterrupt(() => Effect.die(new Error('broken after its caller left'))),
      Effect.as({}),
    ),
});

export const giveUp = defineQuery('playbook', {
  name: 'give_up',
  title: 'Give up',
  description: 'Interrupts its own call.',
  route: { method: 'GET', path: '/give-up' },
  inputSchema: Empty,
  outputSchema: Empty,
  reasons: [],
  handle: () => Effect.interrupt,
});

export const misreport = defineQuery('org', {
  name: 'misreport',
  title: 'Misreport',
  description: 'Returns output that breaks its own output schema.',
  route: { method: 'GET', path: '/misreport' },
  inputSchema: Empty,
  outputSchema: Schema.Struct({ code: Schema.String.check(Schema.isMinLength(5)) }),
  reasons: [],
  handle: () => Effect.succeed({ code: 'x' }),
});

export const overshare = defineQuery('playbook', {
  name: 'overshare',
  title: 'Overshare',
  description: 'Returns a field its output schema does not declare.',
  route: { method: 'GET', path: '/overshare' },
  inputSchema: Empty,
  outputSchema: Schema.Struct({ code: Schema.String }),
  reasons: [],
  handle: () => {
    const row = { code: 'abcde', passwordHash: 'secret' };
    return Effect.succeed(row);
  },
});

export const rejectUndeclared = defineCommand('playbook', {
  name: 'reject_undeclared',
  title: 'Reject undeclared',
  description: 'Rejects with a reason it does not declare.',
  route: { method: 'POST', path: '/reject-undeclared' },
  inputSchema: Empty,
  outputSchema: Empty,
  reasons: noReasonsDeclared,
  handle: () => Effect.fail(new Conflict({ detail: 'taken' })),
});

interface Tree {
  readonly children: readonly Tree[];
}

const TreeSchema: Schema.Codec<Tree> = Schema.Struct({
  children: Schema.Array(Schema.suspend((): Schema.Codec<Tree> => TreeSchema)),
});

export const holdTree = defineQuery('playbook', {
  name: 'hold_tree',
  title: 'Hold tree',
  description: 'Takes a tree of any depth.',
  route: { method: 'GET', path: '/tree' },
  inputSchema: Schema.Struct({ tree: TreeSchema }),
  outputSchema: Schema.Struct({ held: Schema.Boolean }),
  reasons: [],
  handle: () => Effect.succeed({ held: true }),
});

export const linger = defineQuery('playbook', {
  name: 'linger',
  title: 'Linger',
  description: 'Answers after the given number of milliseconds.',
  route: { method: 'GET', path: '/linger' },
  inputSchema: Schema.Struct({ milliseconds: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3_600_000 })) }),
  outputSchema: Schema.Struct({ lingered: Schema.Int }),
  reasons: [],
  handle: ({ milliseconds }) => Effect.sleep(milliseconds).pipe(Effect.as({ lingered: milliseconds })),
});
