import { settingProblemText } from '@on.auto/config';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { marksOf, readToolServerSettings, type Environment } from '../index.ts';

const context = { modelProviders: ['openai'] };

const key = 'graph-api-key-4f1d9a7c2b';

const graph = { url: 'https://graph.example.com/mcp', org: 'acme', headers: { Authorization: 'Bearer ${GRAPH_KEY}' } };

const notes = { command: '/usr/local/bin/notes-mcp-server', org: 'acme' };

function environmentOf(servers: unknown): Environment {
  return { GRAPH_KEY: key, TOOL_SERVERS: JSON.stringify(servers) };
}

function listsOf(servers: unknown) {
  return Effect.runSync(readToolServerSettings(environmentOf(servers), context)).servers.map(({ name, allowed }) => ({
    name,
    allowed,
  }));
}

function problemsOf(servers: unknown): readonly string[] {
  return Effect.runSync(Effect.flip(readToolServerSettings(environmentOf(servers), context))).problems.map((problem) =>
    settingProblemText(problem),
  );
}

describe('the tools of a server, on its entry', () => {
  it('reads the tools allowed, each named as the server lists it', () => {
    expect(
      listsOf({
        graph: { ...graph, allowed: ['search', 'introspect', 'execute'] },
        notes: { ...notes, allowed: ['graph.query.v2'] },
      }),
    ).toEqual([
      { name: 'graph', allowed: ['search', 'introspect', 'execute'] },
      { name: 'notes', allowed: ['graph.query.v2'] },
    ]);
  });

  it('allows every tool on a server whose entry leaves allowed out', () => {
    expect(listsOf({ graph })).toEqual([{ name: 'graph', allowed: null }]);
  });
});

describe('the tools of a server, refused at start', () => {
  it('refuses a name that is not a tool name, at its pointer and never with a value', () => {
    const problems = problemsOf({ graph: { ...graph, allowed: ['graph/search', ''] } });

    expect(problems).toEqual([
      'TOOL_SERVERS: /graph/allowed/0: Expected a tool name of 1 to 128 letters, digits, underscores, hyphens and dots',
      'TOOL_SERVERS: /graph/allowed/1: Expected a tool name of 1 to 128 letters, digits, underscores, hyphens and dots',
    ]);
    expect(problems.join(' ')).not.toContain(key);
  });

  it('refuses *, with what to write instead', () => {
    expect(problemsOf({ graph: { ...graph, allowed: ['search', '*'] } })).toEqual([
      'TOOL_SERVERS: /graph/allowed/1: Every tool of the server is allowed when allowed is left out; name the tools to allow, or leave it out',
    ]);
  });

  it('refuses a tool listed twice', () => {
    expect(problemsOf({ graph: { ...graph, allowed: ['search', 'execute', 'search'] } })).toEqual([
      'TOOL_SERVERS: /graph/allowed/2: search is listed twice',
    ]);
  });

  it('refuses an empty list, saying what leaving it out means', () => {
    expect(problemsOf({ graph: { ...graph, allowed: [] } })).toEqual([
      'TOOL_SERVERS: /graph/allowed: Expected at least one tool; leave allowed out to allow every tool',
    ]);
  });

  it('refuses a list that is not a list of names', () => {
    expect(problemsOf({ graph: { ...graph, allowed: 'search' } })).toEqual([
      'TOOL_SERVERS: /graph/allowed: Expected array',
    ]);
  });
});

function marksReadOf(servers: unknown) {
  return Effect.runSync(readToolServerSettings(environmentOf(servers), context)).servers.map(({ name, marks }) => ({
    name,
    marks,
  }));
}

describe('the marks of the tools of a server, on its entry', () => {
  it('reads the tools marked reads and those marked acts, each named as the server lists it', () => {
    expect(
      marksReadOf({
        graph: { ...graph, marks: { reads: ['search', 'graph.query.v2'], acts: ['execute'] } },
        notes: { ...notes, marks: { acts: ['append'] } },
      }),
    ).toEqual([
      { name: 'graph', marks: { reads: ['search', 'graph.query.v2'], acts: ['execute'] } },
      { name: 'notes', marks: { reads: [], acts: ['append'] } },
    ]);
  });

  it('marks no tool of a server whose entry leaves marks out', () => {
    expect(marksReadOf({ graph })).toEqual([{ name: 'graph', marks: { reads: [], acts: [] } }]);
  });
});

describe('the marks of the tools of a server, refused at start', () => {
  it('refuses a name that is not a tool name and a tool marked twice, at its pointer', () => {
    expect(
      problemsOf({ graph: { ...graph, marks: { reads: ['graph/search', 'search', 'search'], acts: ['*'] } } }),
    ).toEqual([
      'TOOL_SERVERS: /graph/marks/reads/0: Expected a tool name of 1 to 128 letters, digits, underscores, hyphens and dots',
      'TOOL_SERVERS: /graph/marks/reads/2: search is listed twice',
      'TOOL_SERVERS: /graph/marks/acts/0: Expected a tool name of 1 to 128 letters, digits, underscores, hyphens and dots',
    ]);
  });

  it('refuses a tool marked both reads and acts, where it is marked acts', () => {
    expect(problemsOf({ graph: { ...graph, marks: { reads: ['search'], acts: ['execute', 'search'] } } })).toEqual([
      'TOOL_SERVERS: /graph/marks/acts/1: search is marked reads too, and a tool takes one mark',
    ]);
  });

  it('refuses marks with neither list, as an empty list is, saying what leaving it out means', () => {
    expect(problemsOf({ graph: { ...graph, marks: {} } })).toEqual([
      'TOOL_SERVERS: /graph/marks: Expected reads or acts, or both; leave marks out to mark no tool',
    ]);
    expect(problemsOf({ graph: { ...graph, marks: { reads: [], acts: [] } } })).toEqual([
      'TOOL_SERVERS: /graph/marks/reads: Expected at least one tool; leave reads out to mark no tool reads',
      'TOOL_SERVERS: /graph/marks/acts: Expected at least one tool; leave acts out to mark no tool acts',
    ]);
  });
});

describe('the marks an entry is given', () => {
  it('are the marks written, to spread into an entry, and nothing where none are written', () => {
    expect([marksOf({ reads: ['search'] }), marksOf()]).toEqual([{ marks: { reads: ['search'] } }, {}]);
  });
});
