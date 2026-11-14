import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, type Capability } from '../capability/capability.ts';
import { operationsOnDefinitions } from '../operations/definition-catalog.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { echoDeclaration } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { uncheckedPages } from '../testing/page-ports.ts';
import { contributesIn } from './contributes-details.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const contributes = [
  {
    goal: 'paying-customers',
    purpose: 'Measures what each experiment brought in.',
    when: '${ $data.status == "measured" }',
    measures: '/customers',
    final: true,
  },
];

function contributing(written: Schema.Json): Capability {
  return defineCapability({
    ...echoDeclaration,
    summarize: (document) => ({ ...echoDeclaration.summarize(document), details: { contributes: written } }),
  });
}

const capability = contributing(contributes);

const kept = definitionOperationsFor([capability], undefined, uncheckedPages, { goals: true, messages: true });

const notKept = definitionOperationsFor([capability]);

function servedNamingContributes(goals: boolean): readonly boolean[] {
  return operationsOnDefinitions([capability], uncheckedPages, { goals, messages: false }).map(({ registration }) =>
    JSON.stringify(registration.output).includes('contributes'),
  );
}

const greeter = { type: 'echo', name: 'greeter' };

const source = '{"greeting": "Hello"}';

async function savedWhereGoalsAreKept() {
  const definitions = harness();
  const created = await definitions.call(kept.createDefinition, toAlpha(acmeAdmin, { ...greeter, source }));
  return { definitions, created };
}

describe('what a workflow contributes, where goals are kept', () => {
  it('is answered typed in its details by every operation that answers the definition', async () => {
    const { definitions, created } = await savedWhereGoalsAreKept();
    const answered = { details: { contributes } };
    const call = (operation: Parameters<typeof definitions.call>[0], input: object) =>
      definitions.call(operation, toAlpha(acmeAdmin, input));

    expect([
      created,
      await call(kept.getDefinition, greeter),
      await call(kept.updateDefinition, { ...greeter, source: '{"greeting": "Hi"}' }),
      await call(kept.pauseDefinition, { ...greeter, reason: 'A break' }),
      await call(kept.resumeDefinition, greeter),
      await call(kept.retireDefinition, greeter),
      await call(kept.restoreDefinition, greeter),
    ]).toMatchObject(Array.from({ length: 7 }, () => ({ status: 'succeeded', output: answered })));
    expect(await call(kept.listDefinitions, { type: 'echo' })).toMatchObject({
      status: 'succeeded',
      output: { definitions: [answered] },
    });
  });
});

describe('what a workflow contributes, where goals are not kept', () => {
  it('is left out of every answer, so a definition saved while they were kept is still read', async () => {
    const { definitions } = await savedWhereGoalsAreKept();
    const call = (operation: Parameters<typeof definitions.call>[0], input: object) =>
      definitions.call(operation, toAlpha(acmeAdmin, input));
    const answers = [
      await call(notKept.getDefinition, greeter),
      await call(notKept.pauseDefinition, { ...greeter, reason: 'A break' }),
      await call(notKept.resumeDefinition, greeter),
    ];
    const listed = await call(notKept.listDefinitions, { type: 'echo' });

    expect(answers).toMatchObject(Array.from({ length: 3 }, () => ({ status: 'succeeded' })));
    expect([...answers, listed].map((answer) => JSON.stringify(answer).includes('contributes'))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('the contributes kept in the details of a definition', () => {
  it('is read typed, and not at all when it is not a contributes list', () => {
    expect(contributesIn({ contributes })).toEqual(contributes);
    expect(contributesIn({ contributes: 'paying-customers' })).toBeUndefined();
    expect(contributesIn()).toBeUndefined();
  });

  it('is served where goals are kept and not otherwise, through the catalog', () => {
    expect(servedNamingContributes(true)).toContain(true);
    expect(servedNamingContributes(false)).not.toContain(true);
  });
});
