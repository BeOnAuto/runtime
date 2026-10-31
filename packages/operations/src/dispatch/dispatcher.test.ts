import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { rejected, type PipelineStep } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { publishDraft } from '../testing/drafts.ts';
import { harness, toPlaybook, toOrg } from '../testing/harness.ts';
import { addNote, copyNote, getNote, listNotes } from '../testing/notes.ts';
import { labelPlaybook } from '../testing/playbook-labels.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const closedToCommands: PipelineStep = ({ kind }) =>
  kind === 'command' ? Effect.fail(rejected('unavailable', 'The org has used its operations')) : Effect.void;

function recordedSteps(): { readonly steps: readonly PipelineStep[]; readonly passed: () => readonly string[] } {
  const passed: string[] = [];
  const recording =
    (label: string): PipelineStep =>
    ({ name }, { org }) =>
      Effect.sync(() => {
        passed.push(`${label} ${name} in ${org}`);
      });
  return { steps: [recording('first'), recording('second')], passed: () => passed };
}

describe('a dispatched handler', () => {
  it('may call another operation of its scope within the same call', async () => {
    const { dispatcher: calls, run } = harness();
    const copying = (name: string, copy: string) =>
      run(calls.dispatchToPlaybook(copyNote.registration, toAlpha(acmeAdmin, { name, copy })));
    await run(calls.dispatchToPlaybook(addNote.registration, toAlpha(acmeAdmin, { name: 'anvil', text: 'heavy' })));

    expect(await copying('anvil', 'twin')).toEqual({
      status: 'succeeded',
      output: { added: { name: 'twin', text: 'heavy' }, version: 2 },
    });
    expect(await copying('ghost', 'echo')).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no note ghost',
    });
  });

  it('rejects with a reason it declares', async () => {
    const { dispatcher: calls, run } = harness();
    const anvil = toAlpha(acmeAdmin, { name: 'anvil', text: 'heavy' });

    expect(await run(calls.dispatchToPlaybook(addNote.registration, anvil))).toEqual({
      status: 'succeeded',
      output: { added: { name: 'anvil', text: 'heavy' }, version: 1 },
    });
    expect(await run(calls.dispatchToPlaybook(addNote.registration, anvil))).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'A note named anvil exists',
    });
  });

  it('is rejected with a conflict of a concurrent change when a concurrent write to its stream causes a version conflict', async () => {
    const { dispatcher: calls, run } = harness();
    const adding = (name: string) =>
      calls.dispatchToPlaybook(addNote.registration, toAlpha(acmeAdmin, { name, text: name }));

    expect(await run(Effect.all([adding('anvil'), adding('bolt')], { concurrency: 'unbounded' }))).toEqual([
      { status: 'succeeded', output: { added: { name: 'anvil', text: 'anvil' }, version: 1 } },
      {
        status: 'rejected',
        reason: 'conflict',
        detail: 'The state changed while the command was decided',
        kind: 'concurrent_change',
      },
    ]);
  });
});

describe('a dispatched handler rejecting with invalid input', () => {
  it('is rejected with invalid_input, its detail and the issues it points at', async () => {
    const { dispatcher: calls, run } = harness();
    const publishing = (lines: readonly string[]) =>
      run(calls.dispatchToPlaybook(publishDraft.registration, toAlpha(acmeAdmin, { lines })));

    expect(await publishing(['Fine', 'wrong', 'Good', 'bad'])).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The draft has lines to fix',
      issues: [
        { detail: 'Line 2 must start with a capital letter', pointer: '/lines/1' },
        { detail: 'Line 4 must start with a capital letter', pointer: '/lines/3' },
      ],
    });
    expect(await publishing(['Fine', 'Good'])).toEqual({ status: 'succeeded', output: { published: 2 } });
  });

  it('answers at most one hundred of its issues', async () => {
    const { dispatcher: calls, run } = harness();
    const lines = Array.from({ length: 150 }, () => 'lowercase');

    expect(await run(calls.dispatchToPlaybook(publishDraft.registration, toAlpha(acmeAdmin, { lines })))).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The draft has lines to fix',
      issues: Array.from({ length: 100 }, (_unused, index) => ({
        detail: `Line ${index + 1} must start with a capital letter`,
        pointer: `/lines/${index}`,
      })),
    });
  });
});

describe('a dispatched handler rejecting with invalid input that offers options', () => {
  it('carries the options it offers, a question and its choices, each with the issues it states once chosen', async () => {
    const { dispatcher: calls, run } = harness();

    expect(await run(calls.dispatchToPlaybook(publishDraft.registration, toAlpha(acmeAdmin, { lines: [] })))).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The draft has no lines',
      issues: [{ detail: 'Open the draft with a greeting or a title', pointer: '/lines' }],
      options: {
        question: 'What should the draft open with?',
        choices: [
          {
            value: 'greeting',
            title: 'A greeting',
            issues: [{ detail: 'Open the draft with Hello', pointer: '/lines' }],
          },
          {
            value: 'title',
            title: 'A title',
            issues: [{ detail: 'Open the draft with its title', pointer: '/lines' }],
          },
        ],
      },
    });
  });
});

describe('pipeline steps', () => {
  it('run in order once a call is authorized and its playbook exists, before its input is decoded', async () => {
    const { steps, passed } = recordedSteps();
    const { dispatcher: calls, run } = harness({ steps });

    await run(
      calls.dispatchToPlaybook(getNote.registration, toPlaybook('globex', 'gamma')(acmeAdmin, { name: 'gear' })),
    );
    await run(
      calls.dispatchToPlaybook(getNote.registration, toPlaybook('acme', 'nowhere')(acmeAdmin, { name: 'gear' })),
    );
    const invalid = await run(calls.dispatchToPlaybook(getNote.registration, toAlpha(acmeAdmin, { name: 7 })));

    expect(invalid).toMatchObject({ reason: 'invalid_input' });
    expect(passed()).toEqual(['first get_note in acme', 'second get_note in acme']);
  });

  it('reject with at most one hundred issues, each holding only its detail and pointer', async () => {
    const issues = Array.from({ length: 150 }, (_unused, index) => ({ detail: 'busy', pointer: `/${index}`, at: 1 }));
    const crowded: PipelineStep = () => Effect.fail(rejected('unavailable', 'The org is busy', issues));
    const { dispatcher: calls, run } = harness({ steps: [crowded] });

    const outcome = await run(calls.dispatchToPlaybook(listNotes.registration, toAlpha(acmeAdmin)));

    expect(outcome).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'The org is busy',
      issues: Array.from({ length: 100 }, (_unused, index) => ({ detail: 'busy', pointer: `/${index}` })),
    });
  });

  it('may reject a call before its handler runs', async () => {
    const { dispatcher: calls, run } = harness({ steps: [closedToCommands] });
    const unavailable = { status: 'rejected', reason: 'unavailable', detail: 'The org has used its operations' };

    expect(
      await run(calls.dispatchToPlaybook(addNote.registration, toAlpha(acmeAdmin, { name: 'anvil', text: 'x' }))),
    ).toEqual(unavailable);
    expect(
      await run(
        calls.dispatchToOrg(labelPlaybook.registration, toOrg('acme')(acmeAdmin, { playbook: 'alpha', label: 'x' })),
      ),
    ).toEqual(unavailable);
    expect(await run(calls.dispatchToPlaybook(listNotes.registration, toAlpha(acmeAdmin)))).toEqual({
      status: 'succeeded',
      output: { notes: [] },
    });
  });
});
