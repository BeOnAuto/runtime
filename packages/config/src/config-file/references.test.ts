import { describe, expect, it } from 'vitest';

import {
  placeholderNamePattern,
  placeholdersIn,
  placeholdersReplaced,
  referencedVariablesOf,
  substituted,
} from '../index.ts';

describe('the references a substitution finds', () => {
  it('names each reference with its place and the value the environment gave it', () => {
    const value = {
      headers: { Authorization: 'Bearer ${GRAPH_API_KEY}', 'X-Region': 'eu' },
      args: ['--key', '${env:LIMITLESS_KEY}', '$$HOME'],
      mode: '${MODE:-production}',
    };

    expect(substituted(value, '/graph', { GRAPH_API_KEY: 'graph-key-1234', LIMITLESS_KEY: 'limitless-5678' })).toEqual({
      value: {
        headers: { Authorization: 'Bearer graph-key-1234', 'X-Region': 'eu' },
        args: ['--key', 'limitless-5678', '$HOME'],
        mode: 'production',
      },
      problems: [],
      references: [
        { pointer: '/graph/headers/Authorization', value: 'graph-key-1234' },
        { pointer: '/graph/args/1', value: 'limitless-5678' },
        { pointer: '/graph/mode', value: null },
      ],
    });
  });

  it('reads the references of a text in turn, and a `${` without its close as the text it is', () => {
    expect(substituted('${HOST}:${PORT} ${open $$HOME', '/url', { HOST: 'db', PORT: '5432' })).toEqual({
      value: 'db:5432 ${open $HOME',
      problems: [],
      references: [
        { pointer: '/url', value: 'db' },
        { pointer: '/url', value: '5432' },
      ],
    });
  });

  it('reads a text whole, however many `${` it holds without a close', () => {
    const text = '${'.repeat(100_000);

    expect(substituted(text, '/url', {})).toEqual({ value: text, problems: [], references: [] });
  });

  it('finds no reference in text without one, nor in a value that is not text', () => {
    expect(substituted({ count: 2, on: true, none: null, text: 'plain' }, '', {})).toMatchObject({ references: [] });
  });
});

describe('the variables a value refers to', () => {
  it('are named by each reference in either form, at any depth, and never by an escaped $ or plain text', () => {
    const value = {
      url: 'https://${HOST}:${env:PORT:-8443}/v1',
      headers: { authorization: 'Bearer ${TOKEN}', price: '$${COST}' },
      args: ['--key=${TOKEN}', 7, true, null],
    };

    expect(referencedVariablesOf(value)).toEqual(['HOST', 'PORT', 'TOKEN', 'TOKEN']);
    expect(referencedVariablesOf('plain')).toEqual([]);
  });
});

describe('the placeholders a text holds', () => {
  it('are named, and replaced, by each brace around a lowercase name, in turn, and never by a reference or a name of another form', () => {
    expect(placeholdersIn('https://{site}.example.com/{site}/v1?region={region_2}')).toEqual([
      'site',
      'site',
      'region_2',
    ]);
    expect(placeholdersIn('${site} {Site} {2site} {} plain')).toEqual([]);
    expect(placeholdersReplaced('https://{site}.example.com/${site}/{region}', (name) => name.toUpperCase())).toBe(
      'https://SITE.example.com/${site}/REGION',
    );
    expect(
      ['client_id', 'site', 'Site', '2site', 'site-name'].map((name) => placeholderNamePattern.test(name)),
    ).toEqual([true, true, false, false, false]);
  });
});
