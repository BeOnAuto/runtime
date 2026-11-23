import { Effect, Fiber, Layer, Logger } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import {
  allPermissions,
  type AccessDecision,
  type AccessRequest,
  makeDispatcher,
  type PolicyDecisionPoint,
} from '../index.ts';
import { capturedLogs } from '../testing/captured-logs.ts';
import { allowedByTheTest, deniedByTheTest, recordingDecisionPoint } from '../testing/decision-points.ts';
import { harness } from '../testing/harness.ts';
import { memoryLedger, memoryPlaybookRegistry, recordingReporter } from '../testing/index.ts';
import { getNote } from '../testing/notes.ts';
import {
  ada,
  answeredWith,
  answering,
  differenceOf,
  dying,
  fieldsOf,
  onAlpha,
  reportedCalls,
  throwing,
} from '../testing/report-only-calls.ts';

const silent: PolicyDecisionPoint = { decide: () => Effect.never, decideBatch: () => Effect.never };

const noteAnvilMissing = { status: 'rejected', reason: 'not_found', detail: 'There is no note anvil' };

const throwingLogger = Logger.make(() => {
  throw new Error('the log is full');
});

describe('a decision point that never answers', () => {
  it('is given a second, after which its silence is a deny, and the call answers as it would without it', async () => {
    const logs = capturedLogs();
    const services = Layer.mergeAll(
      memoryLedger().layer,
      memoryPlaybookRegistry([{ org: 'acme', playbook: 'alpha' }]),
      recordingReporter().layer,
      TestClock.layer(),
      logs.layer,
    );
    const watched = Effect.gen(function* () {
      const call = yield* Effect.forkChild(
        makeDispatcher([], { reportOnly: silent }).dispatchToPlaybook(
          getNote.registration,
          onAlpha(ada, { name: 'anvil' }),
        ),
      );
      yield* TestClock.adjust('1 second');
      return yield* Fiber.join(call);
    });

    const outcome = await Effect.runPromise(watched.pipe(Effect.provide(services)));

    expect(outcome).toEqual(noteAnvilMissing);
    expect(fieldsOf(logs.logged(), 'decision', 'errors')).toEqual([['deny', 1]]);
  });

  it('leaves a call that is cancelled while it waits cancelled', async () => {
    const { dispatcher, settleAbortedWhileItRuns } = harness({ reportOnly: silent });

    expect(
      await settleAbortedWhileItRuns(
        dispatcher.dispatchToPlaybook(getNote.registration, onAlpha(ada, { name: 'anvil' })),
      ),
    ).toEqual({ status: 'cancelled' });
  });
});

describe('a logger that throws while a difference is reported', () => {
  it('changes no outcome', async () => {
    const { dispatcher, run } = harness({ reportOnly: answering(deniedByTheTest) });

    const outcome = await run(
      dispatcher
        .dispatchToPlaybook(getNote.registration, onAlpha(ada, { name: 'anvil' }))
        .pipe(Effect.provide(Logger.layer([throwingLogger]))),
    );

    expect(outcome).toEqual(noteAnvilMissing);
  });
});

function orgOf({ resource }: AccessRequest): string {
  return resource.type === 'org' ? resource.id : resource.org;
}

function asTheCheckDecides(request: AccessRequest): AccessDecision {
  const everyPermission = request.context.granted.permissions.length === allPermissions.length;
  const inItsOrg = orgOf(request) === request.context.granted.org;
  return request.principal.type === 'person' && inItsOrg && everyPermission ? allowedByTheTest : deniedByTheTest;
}

describe('a dispatcher in report-only mode', () => {
  it('answers every call exactly as the dispatcher without it, and writes the same facts, whatever the decision point decides or does', async () => {
    const plain = await answeredWith();
    const reporting = await Promise.all(
      [answering(allowedByTheTest), answering(deniedByTheTest), dying, throwing].map((point) => answeredWith(point)),
    );

    expect(plain.outcomes.map(({ status }) => status)).toEqual([
      'rejected',
      'succeeded',
      'rejected',
      'rejected',
      'rejected',
      'succeeded',
      'rejected',
      'succeeded',
    ]);
    expect(reporting.map(({ outcomes, streams }) => ({ outcomes, streams }))).toEqual(
      reporting.map(() => ({ outcomes: plain.outcomes, streams: plain.streams })),
    );
    expect(plain.logged).toEqual([]);
  });

  it('logs nothing where the decision point decides as the check does', async () => {
    const agreeing = recordingDecisionPoint(asTheCheckDecides);

    const { logged } = await answeredWith(agreeing.decisionPoint, reportedCalls.slice(0, -1));

    expect(agreeing.asked()).toHaveLength(7);
    expect(logged).toEqual([]);
  });
});

describe('a call the decision point and the check decide otherwise', () => {
  it('is logged where the decision point denies and the check allows, with ids alone', async () => {
    const { logged, text } = await answeredWith(answering(deniedByTheTest));
    const byAda = { org: 'acme', caller: 'person:user_ada', check: 'allow', decision: 'deny' };
    const denied = { ...byAda, determining_policies: 'test-deny', errors: 0 };

    expect(logged).toEqual([
      differenceOf({ ...denied, operation: 'get_note', playbook: 'alpha', scope: 'playbook' }),
      differenceOf({ ...denied, operation: 'add_note', playbook: 'alpha', scope: 'playbook' }),
      differenceOf({ ...denied, operation: 'label_playbook', playbook: 'beta', scope: 'org' }),
      differenceOf({
        ...byAda,
        operation: 'get_note',
        playbook: 'alpha',
        caller: 'service:mailer',
        scope: 'playbook',
        determining_policies: '',
        errors: 1,
      }),
    ]);
    expect(text).not.toContain('Ada Lovelace');
    expect(text).not.toContain('a secret');
  });

  it('is logged where the decision point allows and the check refuses', async () => {
    const { logged } = await answeredWith(answering(allowedByTheTest));

    expect(fieldsOf(logged, 'operation', 'caller', 'check')).toEqual([
      ['add_note', 'person:user_ada', 'deny'],
      ['get_note', 'acme-alpha-reader', 'deny'],
      ['get_note', 'person:user_ada', 'deny'],
      ['label_playbook', 'person:user_ada', 'deny'],
      ['get_note', 'service:mailer', 'allow'],
    ]);
  });

  it('is logged as a deny with an error where the decision point fails or throws, or the caller names no principal', async () => {
    const died = await answeredWith(dying);
    const threw = await answeredWith(throwing);

    expect(fieldsOf(died.logged, 'decision', 'errors')).toEqual([0, 1, 2, 3].map(() => ['deny', 1]));
    expect(threw.logged).toEqual(died.logged);
  });
});
