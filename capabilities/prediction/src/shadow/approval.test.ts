import { allPermissions, type CallerIdentity } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { buildPlaybook, type BuildPlaybook } from '../build-testing/build-playbook.ts';
import {
  builtFrom,
  modelFactsOf,
  runOf,
  savedFunction,
  standingOf,
  visitsRows,
} from '../build-testing/built-versions.ts';
import { approvingDocument } from '../build-testing/called-documents.ts';
import { performedUntilQuiet } from '../build-testing/due-driving.ts';
import { childIdOf } from '../build-work/child-runs.ts';
import { uploadedDailyVisits } from '../testing/daily-documents.ts';

const signedInPerson: CallerIdentity = {
  id: 'person:user|ada',
  name: 'Ada Lovelace',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
};

async function awaitingApproval(playbook: BuildPlaybook, expires = 'P1D'): Promise<string> {
  expect(
    await playbook.call(playbook.operations.create, {
      type: 'interaction',
      name: 'approve-version',
      source: approvingDocument(expires),
    }),
  ).toMatchObject({ status: 'succeeded' });
  const source = uploadedDailyVisits(visitsRows.sha256).replace(
    '  activate: automatic',
    '  activate: { approved: approve-version }',
  );
  await savedFunction(playbook, { source });
  return builtFrom(playbook, ['visits-mean']);
}

function decided(playbook: BuildPlaybook, build: string, decision: string) {
  return playbook.call(playbook.operations.answer, { run_id: childIdOf(build, '/approval'), answer: { decision } });
}

describe('a version that waits for its approver when a newer one is built', () => {
  it('is refused as superseded, its approval cancelled, and the newer version waits in its place', async () => {
    const playbook = buildPlaybook();
    const first = await awaitingApproval(playbook);
    await builtFrom(playbook, ['visits-mean']);
    await performedUntilQuiet(playbook);

    expect((await modelFactsOf(playbook)).filter(({ type }) => type === 'activation_refused')).toMatchObject([
      { data: { version: 1, because: 'superseded', build: first } },
    ]);
    expect(await decided(playbook, first, 'approve')).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      detail: 'A cancel of the run was asked before it took an answer, so it takes none',
    });
    expect(await standingOf(playbook)).toMatchObject({
      output: {
        standing: { models: { active: null, challenger: { version: 2 } }, build: { standing: 'awaiting_approval' } },
      },
    });
  });
});

describe('a version whose activation is approved', () => {
  it('waits for its approver, asked with the function, the version and its card', async () => {
    const playbook = buildPlaybook();
    const build = await awaitingApproval(playbook);

    expect(playbook.children()).toMatchObject([
      {
        name: 'approve-version',
        runId: childIdOf(build, '/approval'),
        input: { function: 'daily-visits', version: 1, card: { build, rule: 'approved' } },
        calledBy: { run_id: build, reference: '/approval', run: 1 },
      },
    ]);
    expect(await standingOf(playbook)).toMatchObject({
      output: {
        standing: { models: { active: null, challenger: { version: 1 } }, build: { standing: 'awaiting_approval' } },
      },
    });
  });

  it('activates once its approver approves, naming who approved it', async () => {
    const playbook = buildPlaybook();
    const build = await awaitingApproval(playbook);
    await decided(playbook, build, 'approve');
    await performedUntilQuiet(playbook);

    expect((await modelFactsOf(playbook)).at(-1)).toMatchObject({
      type: 'version_activated',
      data: { version: 1, rule: 'approved', approved_by: { id: 'acme-admin', name: 'acme-admin' }, build },
    });
    expect(await runOf(playbook, build)).toMatchObject({ output: { status: 'succeeded', output: { version: 1 } } });
  });

  it('is refused when its approver rejects it, naming who rejected it', async () => {
    const playbook = buildPlaybook();
    const build = await awaitingApproval(playbook);
    await decided(playbook, build, 'reject');
    await performedUntilQuiet(playbook);

    expect((await modelFactsOf(playbook)).at(-1)).toMatchObject({
      type: 'activation_refused',
      data: { version: 1, because: 'approver_rejected', refused_by: { id: 'acme-admin', name: 'acme-admin' }, build },
    });
    expect(await standingOf(playbook)).toMatchObject({
      output: { standing: { models: { active: null, challenger: null, latest: 1 }, build: null } },
    });
  });
});

describe('a version whose approval is not given', () => {
  it('is refused as unanswered when its approval expires', async () => {
    const playbook = buildPlaybook();
    await awaitingApproval(playbook, 'PT1M');
    await performedUntilQuiet(playbook, 120_000);

    expect((await modelFactsOf(playbook)).at(-1)).toMatchObject({
      type: 'activation_refused',
      data: { because: 'unanswered' },
    });
  });

  it('is refused as unanswered when its approver cannot be asked', async () => {
    const playbook = buildPlaybook();
    expect(
      await playbook.call(playbook.operations.create, {
        type: 'interaction',
        name: 'approve-version',
        source: approvingDocument(),
      }),
    ).toMatchObject({ status: 'succeeded' });
    const source = uploadedDailyVisits(visitsRows.sha256).replace(
      '  activate: automatic',
      '  activate: { approved: approve-version }',
    );
    await savedFunction(playbook, { source });
    await playbook.call(playbook.operations.retire, { type: 'interaction', name: 'approve-version' });
    await builtFrom(playbook, ['visits-mean']);

    expect((await modelFactsOf(playbook)).at(-1)).toMatchObject({
      type: 'activation_refused',
      data: { because: 'unanswered' },
    });
    expect((await modelFactsOf(playbook)).at(-1)?.data).not.toHaveProperty('refused_by');
  });
});

describe('a version whose approver answers no decision', () => {
  it('is refused as unanswered', async () => {
    const playbook = buildPlaybook();
    expect(
      await playbook.call(playbook.operations.create, {
        type: 'interaction',
        name: 'approve-version',
        source: approvingDocument(),
      }),
    ).toMatchObject({ status: 'succeeded' });
    const source = uploadedDailyVisits(visitsRows.sha256).replace(
      '  activate: automatic',
      '  activate: { approved: approve-version }',
    );
    await savedFunction(playbook, { source });
    await playbook.call(playbook.operations.update, {
      type: 'interaction',
      name: 'approve-version',
      source: approvingDocument()
        .replace('    required: [decision]', '    required: [note]')
        .replace('      decision: { type: string, enum: [approve, reject] }', '      note: { type: string }'),
    });
    const build = await builtFrom(playbook, ['visits-mean']);
    await playbook.call(playbook.operations.answer, {
      run_id: childIdOf(build, '/approval'),
      answer: { note: 'Looks fine' },
    });
    await performedUntilQuiet(playbook);

    expect((await modelFactsOf(playbook)).at(-1)).toMatchObject({
      type: 'activation_refused',
      data: { because: 'unanswered' },
    });
  });
});

describe('a version a signed-in person approves', () => {
  it('names a signed-in person who approves it as the facts name them', async () => {
    const playbook = buildPlaybook();
    const build = await awaitingApproval(playbook);
    await playbook.call(
      playbook.operations.answer,
      { run_id: childIdOf(build, '/approval'), answer: { decision: 'approve' } },
      signedInPerson,
    );
    await performedUntilQuiet(playbook);

    expect((await modelFactsOf(playbook)).at(-1)).toMatchObject({
      type: 'version_activated',
      data: { rule: 'approved', approved_by: { id: 'person:user|ada', name: 'Ada Lovelace' } },
    });
  });
});
