import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { memoryHarness, recallDocument, rememberDocument } from '../testing/index.ts';
import { describeMemoryOutput } from './memory-words.ts';

const later = '2026-10-02T09:00:00.000Z';

async function keeping(remember: readonly string[] = []) {
  const harness = memoryHarness();
  await harness.define('keep-decisions', rememberDocument(remember));
  return harness;
}

describe('a memory function that remembers', () => {
  it('keeps the text its template renders as a new memory of the playbook, written by its run, and answers its id', async () => {
    const harness = await keeping(["tags: ['decisions', '{{ input.about }}']", 'expires: P30D']);

    const ran = await harness.run('keep-decisions', { fact: 'The team ships on Thursdays', about: 'releases' });
    const rows = await harness.rowsOf({ org: 'acme', playbook: 'alpha' });

    expect(ran).toMatchObject({
      status: 'succeeded',
      output: { status: 'succeeded', output: { version: 1, scope: 'playbook' } },
    });
    expect(rows).toMatchObject([
      {
        row: {
          text: 'The team ships on Thursdays',
          tags: '["decisions","releases"]',
          expires_at: '2026-10-31T09:00:00.000Z',
          written_by: 'acme-admin',
          source_definition: 'keep-decisions',
          status: 'kept',
        },
      },
    ]);
  });
});

describe('a memory function that remembers for the organization, or replaces', () => {
  it('keeps it for the organization when its block says so, which a recall of either scope finds', async () => {
    const harness = await keeping(['scope: organization', "about: { from: '2026-10-01', to: '{{ input.about }}' }"]);
    await harness.define('recall-decisions', recallDocument(['scope: organization']), { playbook: 'beta' });

    await harness.run('keep-decisions', { fact: 'Quarterly reviews happen in week 2', about: '2026-12-31' });
    const recalled = await harness.run('recall-decisions', { fact: 'unused' }, { playbook: 'beta' });

    expect(recalled).toMatchObject({
      output: {
        output: {
          memories: [
            {
              scope: 'organization',
              text: 'Quarterly reviews happen in week 2',
              about: { from: '2026-10-01', to: '2026-12-31' },
            },
          ],
        },
        record: { examined: 1, recalled: 1 },
        output_shape: 'memories',
      },
    });
  });

  it('replaces the memory its input names with a new version, which recall finds in its place', async () => {
    const harness = await keeping(["replaces: '{{ input.replaces }}'"]);
    const first = await harness.rememberedId({ text: 'Ship on Thursdays' });
    await harness.define('recall-decisions', recallDocument());

    const replaced = await harness.run(
      'keep-decisions',
      { fact: 'Ship on Wednesdays', replaces: first },
      { at: later },
    );
    const recalled = await harness.run('recall-decisions', { fact: 'unused' }, { at: later });

    expect(replaced).toMatchObject({ output: { output: { id: first, version: 2 } } });
    expect(recalled).toMatchObject({ output: { output: { memories: [{ id: first, text: 'Ship on Wednesdays' }] } } });
  });
});

describe('the memory capability', () => {
  it('finishes at once, reaches nothing outside and refuses a document it cannot read, counting its problems', async () => {
    const { capability } = memoryHarness();
    const prepared = await Effect.runPromise(capability.prepare(recallDocument()));
    const refused = await Effect.runPromise(
      Effect.flip(capability.prepare('---\nremember: { tags: [] }\nrecall: 3\n---\nA body')),
    );
    const once = await Effect.runPromise(Effect.flip(capability.prepare('---\ndescription: Nothing\n---\n')));
    const bare = await Effect.runPromise(capability.prepare('---\nremember: { text: Plain }\n---\n'));

    expect([capability.type, capability.reachesOutside, capability.mayChangeOutside]).toEqual(['memory', false, false]);
    expect(prepared.finishesLaterFor({})).toBe(false);
    expect(prepared.summary).toMatchObject({ details: { recalls: 'both', shape: 'memories' } });
    expect(bare.summary.details).toEqual({ remembers: 'playbook' });
    expect(bare.summary.outputSchema).toMatchObject({ required: ['id', 'version', 'scope'] });
    expect([refused.detail, once.detail]).toEqual([
      'The memory function definition has 3 problems',
      'The memory function definition has a problem',
    ]);
  });
});

describe('the words of what a memory function answered', () => {
  it('say what it kept or recalled, and anything else in the words of a result', () => {
    expect([
      describeMemoryOutput({ id: 'memory-1', version: 2, scope: 'organization' }),
      describeMemoryOutput({ memories: [{ id: 'memory-1' }, { id: 'memory-2' }] }),
      describeMemoryOutput({ memories: [] }),
      describeMemoryOutput('kept'),
    ]).toEqual([
      "It kept version 2 of the memory memory-1 among the organization's memories.",
      'It recalled 2 memories.',
      'It recalled no memory.',
      'Its result: “kept”.',
    ]);
  });
});
