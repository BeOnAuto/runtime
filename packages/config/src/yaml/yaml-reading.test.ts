import { describe, expect, it } from 'vitest';

import { offsetOf, readYaml, type YamlKind, type YamlReading } from './yaml-reading.ts';

const notAMapping = '1:1 A workflow document is a YAML mapping, with document and do at its top';

const workflowKind: YamlKind = {
  noun: 'a workflow document',
  mapping: 'A workflow document is a YAML mapping, with document and do at its top',
  mostDepth: 512,
  emptyIsMapping: false,
};

function read(source: string, kind = workflowKind): YamlReading {
  return readYaml(source, kind);
}

function problemsOf(reading: YamlReading): readonly string[] {
  return 'problems' in reading
    ? reading.problems.map(({ position, detail }) => `${position.line}:${position.column} ${detail}`)
    : [];
}

function locatorOf(text: string): (pointer: string) => { readonly line: number; readonly column: number } {
  const reading = read(text);
  return 'document' in reading ? reading.document.locate : () => ({ line: 0, column: 0 });
}

const source = `document:
  dsl: '1.0.3'
do:
  - first:
      set:
        a/b: 1
  - second~:
      wait: PT1S
`;

describe('reading a YAML document', () => {
  it('gives the mapping as JSON', () => {
    expect(read(source)).toMatchObject({
      document: {
        value: { document: { dsl: '1.0.3' }, do: [{ first: { set: { 'a/b': 1 } } }, { 'second~': { wait: 'PT1S' } }] },
      },
    });
  });

  it('locates a pointer into the document, or the nearest part of it that is there', () => {
    const locate = locatorOf(source);

    expect(locate('')).toEqual({ line: 1, column: 1 });
    expect(locate('/do/0/first/set/a~1b')).toEqual({ line: 6, column: 14 });
    expect(locate('/do/1/second~0/wait')).toEqual({ line: 8, column: 13 });
    expect(locate('/do/1/second~0/missing/deeper')).toEqual({ line: 8, column: 7 });
  });
});

describe('a document that is not YAML this runtime reads', () => {
  it('is rejected with each parse error at its place', () => {
    expect(problemsOf(read('a: [1, 2\nb: 3\n'))).toEqual([
      '2:1 Flow sequence in block collection must be sufficiently indented and end with a ]',
    ]);
    expect(problemsOf(read('a: 1\na: 2\n'))).toEqual(['2:1 Map keys must be unique']);
  });

  it('is rejected when it is not a mapping', () => {
    expect(problemsOf(read('- a list'))).toEqual([notAMapping]);
    expect(problemsOf(read(''))).toEqual([notAMapping]);
  });

  it('is an empty mapping when it is empty and its kind allows that', () => {
    expect(read('# nothing set\n', { ...workflowKind, emptyIsMapping: true })).toMatchObject({
      document: { value: {} },
    });
    expect(problemsOf(read('- a list', { ...workflowKind, emptyIsMapping: true }))).toEqual([notAMapping]);
  });

  it('is rejected when it nests values deeper than its kind allows', () => {
    expect(problemsOf(read('a:\n  b:\n    c: 1\n', { ...workflowKind, mostDepth: 2 }))).toEqual([
      '3:5 The document nests values more than 2 levels deep',
    ]);
  });
});

describe('a document that uses YAML this runtime rejects', () => {
  it('is rejected for aliases and anchors', () => {
    expect(problemsOf(read('a: &shared { b: 1 }\nc: *shared\n'))).toEqual([
      '1:12 Anchors are not allowed in a workflow document',
      '2:4 Aliases are not allowed in a workflow document',
    ]);
  });

  it('is rejected for tags, known or not', () => {
    expect(problemsOf(read('a: !!str 12\nb: !custom value\n'))).toEqual([
      '2:4 Unresolved tag: !custom',
      '1:10 Tags are not allowed in a workflow document: tag:yaml.org,2002:str',
      '2:12 Tags are not allowed in a workflow document: !custom',
    ]);
  });

  it('is rejected for numbers JSON cannot carry and keys that are not plain', () => {
    expect(problemsOf(read('a: .inf\n? [x, y]\n: 1\n'))).toEqual([
      '1:4 Numbers in a workflow document are finite',
      '2:3 Keys in a workflow document are plain text',
    ]);
  });
});

describe('the offset of a node', () => {
  it('is the start of its range, or the start of the document when it has none', () => {
    expect(offsetOf({ range: [4, 7, 8] })).toBe(4);
    expect(offsetOf({})).toBe(0);
    expect(offsetOf(null)).toBe(0);
  });
});
