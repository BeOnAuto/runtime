import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, type Capability } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { overviewOfAProbe, probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';

const decodeDetails = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.JsonObject));

function detailing(type: string): Capability {
  return defineCapability({
    type,
    title: type,
    guide: { name: type },
    noun: { one: type, other: `${type}s` },
    describeOutput: () => 'It answered.',
    mediaType: 'application/json',
    parse: (source: string) => Effect.orDie(decodeDetails(source)),
    summarize: (details) => ({ details, description: `Details ${Object.keys(details).join(' and ')}` }),
    overview: () => ({ body: [], sections: [], appendix: [] }),
    run: () => Effect.succeed({ output: null, record: {} }),
  });
}

const { createDefinition, getDefinition, retireDefinition, updateDefinition } = definitionOperationsFor([
  probe().capability,
  detailing('workflow'),
  detailing('recall'),
]);

const toAlpha = toPlaybook('acme', 'alpha');

const plain = { type: 'probe', name: 'plain' };

function checkingPlain(name: string) {
  return {
    type: 'workflow',
    name,
    source: JSON.stringify({ calls: [{ ...plain, steps: [{ number: 1, name: 'check-plain' }] }] }),
  };
}

function rememberingPlain(name: string) {
  return {
    type: 'recall',
    name,
    source: JSON.stringify({ filters: [{ type: 'run_succeeded', subject: 'probe/plain' }] }),
  };
}

function endedWith(lines: readonly string[], names: readonly string[]): string {
  return `${overviewOfAProbe('plain')}\n${[
    '## Used by',
    lines.join('\n'),
    '## Details',
    '### Used by',
    names.join('\n'),
  ].join('\n\n')}\n`;
}

const calledByWeeklyReview = endedWith(
  ['- The workflow **Weekly review** calls it in step 1, **Check plain**.'],
  ['- `weekly-review`, a workflow'],
);

describe('the overview get_definition answers', () => {
  it('ends with the active definitions of its playbook that name it, and the workflow with what it calls', async () => {
    const { call } = harness();
    await call(createDefinition, toAlpha(acmeAdmin, { ...plain, source: 'x' }));
    await call(createDefinition, toAlpha(acmeAdmin, checkingPlain('weekly-review')));
    await call(createDefinition, toAlpha(acmeAdmin, checkingPlain('stale')));
    await call(retireDefinition, toAlpha(acmeAdmin, { type: 'workflow', name: 'stale' }));
    await call(createDefinition, toAlpha(acmeAdmin, rememberingPlain('review-history')));
    await call(createDefinition, toPlaybook('acme', 'beta')(acmeAdmin, checkingPlain('elsewhere')));

    expect(await call(getDefinition, toAlpha(acmeAdmin, plain))).toMatchObject({
      status: 'succeeded',
      output: {
        overview: endedWith(
          [
            '- The recall function **Review history** remembers its runs.',
            '- The workflow **Weekly review** calls it in step 1, **Check plain**.',
          ],
          ['- `review-history`, a recall function', '- `weekly-review`, a workflow'],
        ),
      },
    });
    expect(await call(getDefinition, toAlpha(acmeAdmin, { type: 'workflow', name: 'weekly-review' }))).toMatchObject({
      output: {
        overview: [
          '# weekly-review',
          'Details calls',
          '## What it calls',
          'It calls the probe definition **Plain**.',
          '## Details',
          '### What it calls',
          '- `plain`, a probe definition\n',
        ].join('\n\n'),
      },
    });
  });
});

describe('the overview a saved definition is answered with', () => {
  it('ends with a workflow saved before it that calls it, on create, on update and on retire alike', async () => {
    const { call } = harness();
    await call(createDefinition, toAlpha(acmeAdmin, checkingPlain('weekly-review')));
    const created = await call(createDefinition, toAlpha(acmeAdmin, { ...plain, source: 'x' }));
    const updated = await call(updateDefinition, toAlpha(acmeAdmin, { ...plain, source: 'y' }));
    const retired = await call(retireDefinition, toAlpha(acmeAdmin, plain));

    expect([created, updated, retired]).toMatchObject([
      { status: 'succeeded', output: { version: 1, overview: calledByWeeklyReview } },
      { status: 'succeeded', output: { version: 2, overview: calledByWeeklyReview } },
      { status: 'succeeded', output: { status: 'retired', overview: calledByWeeklyReview } },
    ]);
  });

  it('is the stored one, as written, when nothing names the definition', async () => {
    const { call } = harness();

    expect(await call(createDefinition, toAlpha(acmeAdmin, { ...plain, source: 'x' }))).toMatchObject({
      status: 'succeeded',
      output: { overview: overviewOfAProbe('plain') },
    });
  });
});

describe('the overview of a definition a workflow calls by its steps', () => {
  const stepped = {
    type: 'workflow',
    name: 'weekly-review',
    source: JSON.stringify({
      title: 'The weekly review',
      calls: [
        { ...plain, steps: [{ number: 2, name: 'check-plain' }] },
        { type: 'recall', name: 'review-history', steps: [{ number: 4, name: 'recall' }] },
        { type: 'probe', name: 'absent', steps: [{ number: 5, name: 'absent' }] },
      ],
    }),
  };

  it('says the title of the workflow and the step it calls it in, and the workflow says each definition it calls', async () => {
    const { call } = harness();
    await call(createDefinition, toAlpha(acmeAdmin, { ...plain, source: 'x' }));
    await call(createDefinition, toAlpha(acmeAdmin, rememberingPlain('review-history')));
    await call(createDefinition, toAlpha(acmeAdmin, stepped));

    expect(await call(getDefinition, toAlpha(acmeAdmin, plain))).toMatchObject({
      output: {
        overview: endedWith(
          [
            '- The recall function **Review history** remembers its runs.',
            '- The workflow **The weekly review** calls it in step 2, **Check plain**.',
          ],
          ['- `review-history`, a recall function', '- `weekly-review`, a workflow'],
        ),
      },
    });
    expect(await call(getDefinition, toAlpha(acmeAdmin, { type: 'workflow', name: 'weekly-review' }))).toMatchObject({
      output: {
        overview: [
          '# weekly-review',
          'Details title and calls',
          '## What it calls',
          'It calls the probe definition **Plain**.',
          'It calls the recall function **Review history**: Details filters.',
          'It calls the probe definition **Absent**, which the playbook does not have yet.',
          '## Details',
          '### What it calls',
          '- `plain`, a probe definition\n- `review-history`, a recall function\n- `absent`, a probe definition\n',
        ].join('\n\n'),
      },
    });
  });
});
