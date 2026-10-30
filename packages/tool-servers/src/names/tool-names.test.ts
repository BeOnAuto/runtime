import { describe, expect, it } from 'vitest';

import { modelFacingNames, type Referring } from './model-facing-names.ts';
import { isToolName, namesEveryTool, toolReferenceOf, writtenOf, type ToolReference } from './tool-reference.ts';
import { inWords, toolsInWords } from './tool-words.ts';

const named = (...written: readonly string[]) =>
  modelFacingNames(
    written.map((each): Referring => ({ reference: toolReferenceOf(each) ?? { server: '', tool: '' } })),
  ).map(({ name }) => name);

const serverPartsOf = (...written: readonly string[]) =>
  named(...written).map((name) => name.slice(0, name.indexOf('__')));

describe('a tool written in a reasoning function', () => {
  it('reads server/tool and server/*', () => {
    expect(toolReferenceOf('graph/search')).toEqual({ server: 'graph', tool: 'search' });
    expect(toolReferenceOf('graph/graph.query.v2')).toEqual({ server: 'graph', tool: 'graph.query.v2' });
    expect(toolReferenceOf('graph/*')).toEqual({ server: 'graph', tool: '*' });
    expect(namesEveryTool({ server: 'graph', tool: '*' })).toBe(true);
    expect(namesEveryTool({ server: 'graph', tool: 'search' })).toBe(false);
    expect(writtenOf({ server: 'graph', tool: 'search' })).toBe('graph/search');
  });

  it('refuses what is not server/tool', () => {
    expect(toolReferenceOf('search')).toBeUndefined();
    expect(toolReferenceOf('/search')).toBeUndefined();
    expect(toolReferenceOf('Graph/search')).toBeUndefined();
    expect(toolReferenceOf('graph/sea rch')).toBeUndefined();
    expect(toolReferenceOf('graph/')).toBeUndefined();
    expect(isToolName('x'.repeat(129))).toBe(false);
  });
});

describe('the names the model sees', () => {
  it('names a tool server__tool, with what a provider refuses mapped to underscores', () => {
    expect(named('graph/search', 'graph/graph.query.v2', 'crm-eu/find-person', 'billing/search')).toEqual([
      'graph__search',
      'graph__graph_query_v2',
      'crm_eu__find_person',
      'billing__search',
    ]);
  });

  it('splits at its first __ into the server, whatever the tool holds and however it is cut', () => {
    expect(
      serverPartsOf('crm-eu/find__person', 'crm-eu/__private', 'graph/a.b', 'graph/a_b', `x-1/${'y'.repeat(100)}`),
    ).toEqual(['crm_eu', 'crm_eu', 'graph', 'graph', 'x_1']);
  });

  it('cuts a name over 64 characters and keeps it apart with a hash', () => {
    const [name] = named(`graph/${'a'.repeat(100)}`);

    expect(name).toHaveLength(64);
    expect(name).toMatch(/^graph__a{48}_[0-9a-f]{8}$/u);
  });

  it('keeps two tools apart whose names map to the same name', () => {
    const names = named('graph/a.b', 'graph/a_b', 'graph/c');

    expect(names[0]).toMatch(/^graph__a_b_[0-9a-f]{8}$/u);
    expect(names[1]).toMatch(/^graph__a_b_[0-9a-f]{8}$/u);
    expect(names[0]).not.toBe(names[1]);
    expect(names[2]).toBe('graph__c');
  });
});

describe('collisions after shortening tool names', () => {
  it('keeps a shortened name apart from a tool already named for its shortened form', () => {
    const long = `graph/${'x'.repeat(60)}`;
    const short = `graph/${'x'.repeat(48)}_9684c8b8`;

    for (const references of [
      [long, short],
      [short, long],
    ]) {
      const names = named(...references);

      expect(new Set(names).size).toBe(2);
      expect(names.every((name) => name.length <= 64)).toBe(true);
      expect(names.every((name) => /^[A-Za-z0-9_]+$/u.test(name))).toBe(true);
    }
  });

  it('keeps checking generated names when a disambiguating suffix is also taken', () => {
    const original = `graph__${'x'.repeat(48)}_9684c8b8`;
    const suffixed = `${original.slice(0, 62)}_1`;
    const references: readonly ToolReference[] = [
      { server: 'graph', tool: 'x'.repeat(60) },
      { server: 'graph', tool: suffixed.slice('graph__'.length) },
      { server: 'graph', tool: original.slice('graph__'.length) },
    ];
    const tools = modelFacingNames(references.map((reference): Referring => ({ reference })));

    expect(tools.map(({ name }) => name)).toEqual([original, suffixed, `${original.slice(0, 62)}_2`]);
    expect(tools.map(({ reference }) => reference)).toEqual(references);
  });
});

describe('tools in words', () => {
  it('says a name in lowercase words', () => {
    expect(inWords('getLifelogs')).toBe('get lifelogs');
    expect(inWords('graph.query_v2')).toBe('graph query v2');
    expect(inWords('crm-eu')).toBe('crm eu');
    expect(inWords('reports/monthly:v2')).toBe('reports monthly v2');
  });

  it('says the tools a run used, by server, once each', () => {
    expect(toolsInWords([])).toBe('no tool');
    expect(toolsInWords([{ server: 'graph', tool: 'search' }])).toBe('the search tool of graph');
    expect(
      toolsInWords([
        { server: 'graph', tool: 'search' },
        { server: 'graph', tool: 'execute' },
        { server: 'graph', tool: 'search' },
        { server: 'limitless', tool: 'getLifelogs' },
      ]),
    ).toBe('the search and execute tools of graph and the get lifelogs tool of limitless');
  });
});
