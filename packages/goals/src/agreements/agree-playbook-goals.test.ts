import { goalsDocumentOf, playbookGoalsSaved } from '@on.auto/definitions/goals';
import {
  allPermissions,
  Caller,
  makeDispatcher,
  PlaybookContext,
  playbookLedgerOf,
  type CallerIdentity,
  type PlaybookRequest,
} from '@on.auto/operations';
import { memoryLedger, memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { goalsText, leadGoalId, plainGoalId, restatedGoalsText } from '@on.auto/playbooks/testing';
import { Effect, Layer, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { goalsReadIn } from '../reads/get-playbook-goals.ts';
import { agreePlaybookGoals, agreePlaybookGoalsWhere } from './agree-playbook-goals.ts';
import { goalsAwaitingAYesIn } from './goals-awaiting.ts';

const ada: CallerIdentity = {
  id: 'person:user_2ada',
  name: 'Ada',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
};

const alpha = { org: 'acme', playbook: 'alpha' };

function aPlaybook(agreeing = agreePlaybookGoals) {
  const ledger = memoryLedger();
  const services = Layer.mergeAll(ledger.layer, memoryPlaybookRegistry([alpha]), recordingReporter().layer);
  const context = playbookLedgerOf(ledger.service, alpha);
  return {
    saved: (text: string) =>
      Effect.runPromise(
        playbookGoalsSaved({ document: Result.getOrThrow(goalsDocumentOf(text)), assessed: new Set() }).pipe(
          Effect.provideService(Caller, ada),
          Effect.provide(context),
        ),
      ),
    agreed: (input: PlaybookRequest['input']) =>
      Effect.runPromise(
        makeDispatcher([])
          .dispatchToPlaybook(agreeing.registration, { caller: ada, ...alpha, input, encoding: 'json' })
          .pipe(Effect.provide(services)),
      ),
    read: () =>
      Effect.runPromise(goalsReadIn.pipe(Effect.provideService(PlaybookContext, alpha), Effect.provide(context))),
    awaiting: () =>
      Effect.runPromise(
        goalsAwaitingAYesIn.pipe(Effect.provideService(PlaybookContext, alpha), Effect.provide(context)),
      ),
  };
}

const atAnInstant: unknown = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u);

const noGoalsYet: unknown = expect.stringMatching(/^This playbook has no saved goals yet/u);

describe('agree_playbook_goals', () => {
  it('is a playbook command at POST /goals/agreed that may be sent again', () => {
    expect(agreePlaybookGoals.registration).toMatchObject({
      name: 'agree_playbook_goals',
      scope: 'playbook',
      kind: 'command',
      route: { method: 'POST', path: '/goals/agreed' },
      repeatable: true,
      reasons: ['invalid_input', 'conflict'],
    });
    expect(agreePlaybookGoals.registration.servedOverHttpAlone).toBeUndefined();
  });

  it('records the yes at the version the person saw and answers each goal with it, which the goals read shows', async () => {
    const playbook = aPlaybook();
    await playbook.saved(goalsText);

    const answer = await playbook.agreed({ version: 1 });
    const read = await playbook.read();

    const agreed = { at: atAnInstant, by: ada.id, version: 1 };
    expect(answer).toMatchObject({
      status: 'succeeded',
      output: {
        version: 1,
        goals: [
          { id: leadGoalId, agreed },
          { id: plainGoalId, agreed },
        ],
      },
    });
    expect(read.goals.map(({ agreed: yes }) => yes)).toEqual([agreed, agreed]);
  });
});

describe('a yes to some of the goals', () => {
  it('answers a goal not named with no yes, and says in plain words which goals still wait for one', async () => {
    const playbook = aPlaybook();
    await playbook.saved(goalsText);

    const answer = await playbook.agreed({ version: 1, ids: [leadGoalId] });
    const words = agreePlaybookGoals.registration.plainLanguage;
    const yes = { at: '2026-11-13T10:00:00.000Z', by: ada.id, version: 1 };

    expect(answer).toMatchObject({
      status: 'succeeded',
      output: {
        version: 1,
        goals: [{ id: leadGoalId, agreed: { at: atAnInstant, by: ada.id, version: 1 } }, { id: plainGoalId }],
      },
    });
    expect(words?.attempt({ version: 1 })).toBe("record the person's yes to version 1 of the goals");
    expect(
      words?.outcome({ version: 1, goals: [{ id: leadGoalId, agreed: yes }, { id: plainGoalId }] }, { version: 1 }),
    ).toBe(`Recorded the person's yes to version 1 of the goals. Still waiting for a yes: ${plainGoalId}.`);
    expect(words?.outcome({ version: 2, goals: [] }, { version: 2 })).toBe(
      "Recorded the person's yes to version 2 of the goals.",
    );
  });
});

describe('the yes where Auto sends no goal messages', () => {
  it('tells the agent, as it plans the build, that no goal messages are sent and a post needs the yes', () => {
    const words = agreePlaybookGoalsWhere(false).registration.plainLanguage;

    expect(words?.outcome({ version: 1, goals: [] }, { version: 1 })).toBe(
      "Recorded the person's yes to version 1 of the goals. Auto sends no goal messages here: if the person asked to be told, tell them so first, and build a post only after their yes.",
    );
    expect(agreePlaybookGoalsWhere(true)).toBe(agreePlaybookGoals);
  });
});

describe('before_building in the answer of a yes', () => {
  it('carries, with messages off, that Auto sends no goal messages, and is left out with messages on', async () => {
    const untold = aPlaybook(agreePlaybookGoalsWhere(false));
    await untold.saved(goalsText);
    const told = aPlaybook();
    await told.saved(goalsText);

    expect(await untold.agreed({ version: 1 })).toMatchObject({
      output: {
        before_building:
          'Auto sends no goal messages here: if the person asked to be told, tell them so first, and build a post only after their yes.',
      },
    });
    expect(await told.agreed({ version: 1 })).not.toHaveProperty('output.before_building');
  });
});

describe('whether the goals await a yes', () => {
  it('is true for goals saved and not agreed, false once agreed, and true again after a change', async () => {
    const playbook = aPlaybook();
    await playbook.saved(goalsText);
    const saved = await playbook.awaiting();
    await playbook.agreed({ version: 1 });
    const agreed = await playbook.awaiting();
    await playbook.saved(restatedGoalsText);

    expect([saved, agreed, await playbook.awaiting()]).toEqual([true, false, true]);
  });
});

describe('a yes after the goals change', () => {
  it('drops the yes of the goal saved with a change, keeps the other, and refuses a yes to the version before', async () => {
    const playbook = aPlaybook();
    await playbook.saved(goalsText);
    await playbook.agreed({ version: 1 });
    await playbook.saved(restatedGoalsText);
    const changed = await playbook.read();
    const late = await playbook.agreed({ version: 1 });
    await playbook.agreed({ version: 2 });

    expect(changed.goals.map(({ id, agreed }) => ({ id, version: agreed?.version }))).toEqual([
      { id: leadGoalId, version: undefined },
      { id: plainGoalId, version: 1 },
    ]);
    expect(late).toMatchObject({ status: 'rejected', reason: 'conflict' });
    expect((await playbook.read()).goals.map(({ agreed }) => agreed?.version)).toEqual([2, 1]);
  });
});

describe('a yes that is refused', () => {
  it('refuses a version below 0 and an empty list of goals before it reads anything', async () => {
    const playbook = aPlaybook();

    expect(await playbook.agreed({ version: -1 })).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
    expect(await playbook.agreed({ version: 1, ids: [] })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
    });
    expect(await playbook.agreed({ version: 0 })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      detail: noGoalsYet,
    });
  });
});
