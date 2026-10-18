import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, type Capability } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { overviewOfAProbe, probe } from '../testing/probe.ts';

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
    summarize: (details) => ({ details }),
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

function callingPlain(name: string) {
  return { type: 'workflow', name, source: JSON.stringify({ calls: [plain] }) };
}

function rememberingPlain(name: string) {
  return {
    type: 'recall',
    name,
    source: JSON.stringify({ filters: [{ type: 'run_succeeded', subject: 'probe/plain' }] }),
  };
}

function endedWith(...lines: readonly string[]): string {
  return `${overviewOfAProbe('plain')}\n## Used by\n\n${lines.join('\n')}\n`;
}

const calledByWeeklyReview = '- The workflow **weekly-review** calls it.';

describe('the overview get_definition answers', () => {
  it('ends with the active definitions of its playbook that name it, and lists nothing for one nobody names', async () => {
    const { call } = harness();
    await call(createDefinition, toAlpha(acmeAdmin, { ...plain, source: 'x' }));
    await call(createDefinition, toAlpha(acmeAdmin, callingPlain('weekly-review')));
    await call(createDefinition, toAlpha(acmeAdmin, callingPlain('stale')));
    await call(retireDefinition, toAlpha(acmeAdmin, { type: 'workflow', name: 'stale' }));
    await call(createDefinition, toAlpha(acmeAdmin, rememberingPlain('review-history')));
    await call(createDefinition, toPlaybook('acme', 'beta')(acmeAdmin, callingPlain('elsewhere')));

    expect(await call(getDefinition, toAlpha(acmeAdmin, plain))).toMatchObject({
      status: 'succeeded',
      output: {
        overview: endedWith('- The recall function **review-history** remembers its runs.', calledByWeeklyReview),
      },
    });
    expect(await call(getDefinition, toAlpha(acmeAdmin, { type: 'workflow', name: 'weekly-review' }))).toMatchObject({
      output: { overview: '# weekly-review\n\nThis workflow has no description yet.\n' },
    });
  });
});

describe('the overview a saved definition is answered with', () => {
  it('ends with a workflow saved before it that calls it, on create, on update and on retire alike', async () => {
    const { call } = harness();
    await call(createDefinition, toAlpha(acmeAdmin, callingPlain('weekly-review')));
    const created = await call(createDefinition, toAlpha(acmeAdmin, { ...plain, source: 'x' }));
    const updated = await call(updateDefinition, toAlpha(acmeAdmin, { ...plain, source: 'y' }));
    const retired = await call(retireDefinition, toAlpha(acmeAdmin, plain));

    expect([created, updated, retired]).toMatchObject([
      { status: 'succeeded', output: { version: 1, overview: endedWith(calledByWeeklyReview) } },
      { status: 'succeeded', output: { version: 2, overview: endedWith(calledByWeeklyReview) } },
      { status: 'succeeded', output: { status: 'retired', overview: endedWith(calledByWeeklyReview) } },
    ]);
  });

  it('is the stored one when nothing names the definition', async () => {
    const { call } = harness();

    expect(await call(createDefinition, toAlpha(acmeAdmin, { ...plain, source: 'x' }))).toMatchObject({
      status: 'succeeded',
      output: { overview: overviewOfAProbe('plain') },
    });
  });
});
