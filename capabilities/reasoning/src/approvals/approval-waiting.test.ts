import type { RunContext } from '@on.auto/definitions';
import { recordingJournal } from '@on.auto/definitions/testing';
import { OrgMembership, type CallerIdentity } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ApprovalPorts } from '../capability/run-services.ts';
import { firstAttempt, runContextWith } from '../testing/reasoning-runs.ts';
import { waitingOf } from './approval-waiting.ts';
import { approvalsSpent, noContentToGoOnFrom, nobodyToAsk, noWayToPassItOn } from './approval-words.ts';

const signing = { sign: () => Effect.succeed('signed') };

const priya: CallerIdentity = {
  id: 'person:user_7kLm2',
  name: 'Priya Shah',
  org: 'acme',
  permissions: [],
  playbooks: '*',
};

const aKey: CallerIdentity = { ...priya, id: 'acme-key-1' };

const aPlaybook: CallerIdentity = { ...priya, id: 'playbook:alpha' };

function runOf(caller = priya, requests = 0, actsFor?: string): RunContext {
  return {
    ...runContextWith(recordingJournal(() => false, { ...firstAttempt, requests })),
    caller,
    ...(actsFor === undefined ? {} : { actsFor }),
  };
}

function waiting(ports: ApprovalPorts, run: RunContext, keepsContent: boolean) {
  return Effect.runSync(waitingOf(ports, run, keepsContent));
}

function waitingInAnOrgPriyaLeft(run: RunContext) {
  return Effect.runSync(
    waitingOf(signing, run, true).pipe(
      Effect.provideService(OrgMembership, (_org, person) => Effect.succeed(person !== priya.id)),
    ),
  );
}

describe('whether a run can wait for a person to approve an action', () => {
  it('waits on the person it acts for while it may wait again, its servers keep content and its host passes approvals on', () => {
    expect(waiting(signing, runOf(), true)).toEqual({ asks: true, person: 'person:user_7kLm2' });
    expect(waiting(signing, runOf(priya, 2), true)).toEqual({ asks: true, person: 'person:user_7kLm2' });
  });

  it('does not wait, with why, where nobody can pass an approval on, nothing to go on from is kept, or it waited three times', () => {
    expect([
      waiting({}, runOf(), true),
      waiting(signing, runOf(), false),
      waiting(signing, runOf(priya, 3), true),
    ]).toEqual([
      { asks: false, because: noWayToPassItOn },
      { asks: false, because: noContentToGoOnFrom },
      { asks: false, because: approvalsSpent },
    ]);
  });
});

describe('the person a run waits on for an approval', () => {
  it('is the person a run its caller is not acts for, as a triggered run does', () => {
    expect(waiting(signing, runOf(aPlaybook, 0, 'person:user_7kLm2'), true)).toEqual({
      asks: true,
      person: 'person:user_7kLm2',
    });
  });

  it('is nobody where the run acts for no person, or for one who has left the organization', () => {
    expect([
      waiting(signing, runOf(aKey), true),
      waiting(signing, runOf(aPlaybook, 0, 'acme-key-1'), true),
      waitingInAnOrgPriyaLeft(runOf()),
      waitingInAnOrgPriyaLeft(runOf(aPlaybook, 0, 'person:user_7kLm2')),
    ]).toEqual([
      { asks: false, because: nobodyToAsk },
      { asks: false, because: nobodyToAsk },
      { asks: false, because: nobodyToAsk },
      { asks: false, because: nobodyToAsk },
    ]);
  });
});
