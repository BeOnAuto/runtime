import { preparedPolicies, type PreparePolicies } from '@on.auto/access-control';
import { renderedGuidePages, type GuidePages } from '@on.auto/api';
import { createApiKey } from '@on.auto/identity';
import { describe, expect, it } from 'vitest';

import { startServerInProcess } from '../../lifecycle/lifecycle.ts';
import { layoutLeftOnAFileBy, layoutOfTheImage, layoutState } from '../records/migrated-ledger.ts';
import { shippedSettings } from '../settings/shipped-settings.ts';
import { asSentTo, inProcessOrigin } from './in-process-origins.ts';
import { deeplyFrozen, preparedOnce, preparedParts, readOnlyMapOf } from './prepared-parts.ts';
import { testComposition } from './test-compositions.ts';

type Parts = NonNullable<Parameters<typeof testComposition>[0]>;

const permissions: Parameters<typeof createApiKey>[0]['permissions'] = [
  'org:read',
  'org:write',
  'playbook:read',
  'playbook:write',
];

const admin = createApiKey({ id: 'acme-admin', org: 'acme', permissions, playbooks: '*' });

const reader = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['playbook:read'], playbooks: ['alpha'] });

const environment = {
  HOST: '127.0.0.1',
  PORT: '0',
  LEDGER_FILE: ':memory:',
  API_KEYS: JSON.stringify([admin.entry, reader.entry]),
  AUTO_CLIENTS: 'false',
};

interface Answered {
  readonly status: number;
  readonly text: string;
}

interface Answers {
  readonly pages: readonly Answered[];
  readonly decided: readonly number[];
}

async function answersOfAServerWith(parts: Parts): Promise<Answers> {
  const origin = inProcessOrigin();
  const server = await startServerInProcess(environment, testComposition(parts), origin);
  const answer = asSentTo(server.fetch);
  const asked = async (path: string, key?: string, body?: unknown): Promise<Answered> => {
    const headers = key === undefined ? {} : { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
    const init = body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) };
    const response = await answer(new Request(`${origin}${path}`, init));
    return { status: response.status, text: await response.text() };
  };
  const alpha = { playbook: 'alpha', name: 'Alpha' };
  const pages = [
    await asked('/debug'),
    await asked('/v1/guides/start'),
    await asked('/v1/orgs/acme/providers', admin.key),
  ];
  const made = [
    await asked('/v1/orgs/acme/playbooks', reader.key, alpha),
    await asked('/v1/orgs/acme/playbooks', admin.key, alpha),
  ];
  const answers = { pages, decided: made.map(({ status }) => status) };
  await server.stop();
  return answers;
}

function everyThingHeldBy(value: unknown, seen: Set<unknown> = new Set()): ReadonlySet<unknown> {
  const holding = (typeof value === 'object' && value !== null) || typeof value === 'function';
  if (holding && !seen.has(value)) {
    seen.add(value);
    for (const held of Object.values(Object.assign({}, value))) {
      everyThingHeldBy(held, seen);
    }
  }
  return seen;
}

function rowsOf(
  { rowsIn }: { readonly rowsIn: Readonly<Record<string, number>> },
  kept: (table: string) => boolean,
): readonly (readonly [string, number])[] {
  return Object.entries(rowsIn).filter(([table]: readonly [string, number]) => kept(table));
}

function failingOnceFor(
  failing: string,
  told: (question: string) => void,
): (question: string) => { readonly answer: string } {
  const failed = new Set<string>();
  return (question) => {
    told(question);
    if (question === failing && !failed.has(question)) {
      failed.add(question);
      throw new Error('not yet');
    }
    return { answer: question };
  };
}

describe('a test server given none of the prepared parts', () => {
  it('prepares its guide pages, policies, providers and ledger itself, and answers every call as a server given them answers it', async () => {
    const answeredItself = await answersOfAServerWith({ goals: false, preparingItself: true });
    const answeredGiven = await answersOfAServerWith({ goals: false });

    expect(answeredGiven).toEqual(answeredItself);
    expect(answeredItself.pages.map(({ status }) => status)).toEqual([200, 200, 200]);
    expect(answeredItself.decided).toEqual([403, 201]);
  });
});

describe('the guide pages a test server is given', () => {
  it('are each page it serves as an agent and the page at /debug read it, rendered as a server renders it as it starts', async () => {
    const asked: { readonly agent: Readonly<Parameters<GuidePages['forTheAgent']>>[]; readonly html: string[] } = {
      agent: [],
      html: [],
    };
    const guidePages: GuidePages = {
      forTheAgent: (path, written, variables) => {
        asked.agent.push([path, written, variables]);
        return preparedParts.guidePages.forTheAgent(path, written, variables);
      },
      asHtml: (markdown) => {
        asked.html.push(markdown);
        return preparedParts.guidePages.asHtml(markdown);
      },
    };

    await answersOfAServerWith({ goals: false, guidePages });

    expect(asked.agent.map(([path]) => path)).toContain('concepts/terminology.md');
    expect(asked.html.length).toBeGreaterThan(0);
    expect(asked.agent.map((page) => preparedParts.guidePages.forTheAgent(...page))).toEqual(
      asked.agent.map((page) => renderedGuidePages.forTheAgent(...page)),
    );
    expect(asked.html.map((markdown) => preparedParts.guidePages.asHtml(markdown))).toEqual(
      asked.html.map((markdown) => renderedGuidePages.asHtml(markdown)),
    );
  });
});

describe('the policies a test server is given', () => {
  it('are the shipped policies, prepared for the engine as a server prepares them as it starts, once for every server', async () => {
    const asked: Readonly<Parameters<PreparePolicies>>[] = [];
    const preparingPolicies: PreparePolicies = (cedar, texts) => {
      asked.push([cedar, texts]);
      return preparedParts.preparingPolicies(cedar, texts);
    };

    await answersOfAServerWith({ goals: false, preparingPolicies });
    await answersOfAServerWith({ goals: false, preparingPolicies });
    const given = asked.map((question) => preparedParts.preparingPolicies(...question));
    const preparedItself = asked.map((question) => preparedPolicies(...question));

    expect(given).toHaveLength(2);
    expect(new Set(given).size).toBe(1);
    expect(given.map((prepared) => Object.assign({}, prepared))).toEqual(
      preparedItself.map((prepared) => Object.assign({}, prepared)),
    );
  });
});

describe('the providers a test server is given', () => {
  it('are the providers the shipped files hold, read as a server reads them as it starts', () => {
    const { providers, documents } = preparedParts.shippedSettings.providers;

    expect(providers).toEqual(shippedSettings.providers.providers);
    expect(new Map(documents)).toEqual(shippedSettings.providers.documents);
    expect(providers.length).toBeGreaterThan(0);
  });
});

describe('the ledger a test server is given', () => {
  it('is the image of an empty ledger, laid out as a server lays out the ledger it migrates as it starts', async () => {
    const leftByAServer = await layoutLeftOnAFileBy(async (ledgerFile) => {
      const started = testComposition({ goals: false, preparingItself: true });
      const server = await startServerInProcess(
        { ...environment, LEDGER_FILE: ledgerFile },
        started,
        inProcessOrigin(),
      );
      await server.stop();
    });
    const given = layoutOfTheImage(preparedParts.ledgerImage());

    expect(given.schema).toEqual(leftByAServer.schema);
    expect(Object.keys(given.rowsIn)).toEqual(Object.keys(leftByAServer.rowsIn));
    expect(rowsOf(given, (table) => !layoutState.has(table))).toEqual(
      rowsOf(leftByAServer, (table) => !layoutState.has(table)).map(([table]) => [table, 0]),
    );
    expect(rowsOf(given, (table) => layoutState.has(table))).toEqual(
      rowsOf(leftByAServer, (table) => layoutState.has(table)),
    );
  });
});

describe('the prepared parts', () => {
  it('are frozen through and through, so no server or test changes what the next is given', async () => {
    const before = structuredClone(preparedParts.shippedSettings.providers.providers);
    const imageBefore = preparedParts.ledgerImage();
    const held = [...everyThingHeldBy(preparedParts)];
    const { providers, documents } = preparedParts.shippedSettings.providers;

    const decided = [await answersOfAServerWith({ goals: false }), await answersOfAServerWith({ goals: false })].map(
      (answers) => answers.decided,
    );
    preparedParts.ledgerImage().fill(0);

    expect(decided).toEqual([
      [403, 201],
      [403, 201],
    ]);
    expect(preparedParts.ledgerImage()).toEqual(imageBefore);
    expect(held.filter((each) => !Object.isFrozen(each))).toEqual([]);
    expect(held.filter((each) => each instanceof Map)).toEqual([]);
    expect(held.filter((each) => each instanceof Set)).toEqual([]);
    expect(() => Reflect.apply(Array.prototype.push, providers, [providers[0]])).toThrow(TypeError);
    expect(Reflect.set(preparedParts, 'guidePages', renderedGuidePages)).toBe(false);
    expect(['set', 'delete', 'clear'].filter((change) => change in documents)).toEqual([]);
    expect(preparedParts.shippedSettings.providers.providers).toEqual(before);
  });

  it('give each answer prepared once for each question, frozen, and ask again a question whose preparing failed', () => {
    const prepared: string[] = [];
    const answerOf = preparedOnce(
      failingOnceFor('refused', (question) => {
        prepared.push(question);
      }),
      (question) => question,
    );

    const first = answerOf('a');
    expect(() => answerOf('refused')).toThrow('not yet');
    const answers = [answerOf('a'), answerOf('b'), answerOf('refused'), answerOf('refused')];

    expect(answers[0]).toBe(first);
    expect(answers.map(({ answer }) => answer)).toEqual(['a', 'b', 'refused', 'refused']);
    expect(prepared).toEqual(['a', 'refused', 'b', 'refused']);
    expect(answers.every((answer) => Object.isFrozen(answer))).toBe(true);
  });
});

describe('a map made read-only', () => {
  it('reads as the map it was made from, every way a map is read, and holds no way to change it', () => {
    const given = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    const readOnly = readOnlyMapOf(given);
    const visited: (readonly [string, number, boolean])[] = [];
    readOnly.forEach((value, key, map) => {
      visited.push([key, value, map === readOnly]);
    });
    given.set('c', 3);

    expect([readOnly.size, readOnly.get('a'), readOnly.has('b'), readOnly.has('c')]).toEqual([2, 1, true, false]);
    expect([[...readOnly], [...readOnly.entries()], [...readOnly.keys()], [...readOnly.values()]]).toEqual([
      [
        ['a', 1],
        ['b', 2],
      ],
      [
        ['a', 1],
        ['b', 2],
      ],
      ['a', 'b'],
      [1, 2],
    ]);
    expect(visited).toEqual([
      ['a', 1, true],
      ['b', 2, true],
    ]);
    expect([Object.isFrozen(readOnly), readOnly instanceof Map]).toEqual([true, false]);
  });
});

describe('a value frozen through and through', () => {
  it('is the value given, it and every object and function it holds frozen, each once', () => {
    const shared = { deep: 1 };
    const value = { list: [shared, shared], each: () => 1, frozen: Object.freeze({ inner: {} }) };

    const frozen = deeplyFrozen(value);

    expect(frozen).toBe(value);
    expect([value, value.list, shared, value.each, value.frozen.inner].every((each) => Object.isFrozen(each))).toBe(
      true,
    );
  });
});
