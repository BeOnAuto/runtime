import { describe, expect, it } from 'vitest';

import {
  PORTABLE_MAX_BYTES,
  PORTABLE_MAX_DEFINITIONS,
  canonicalJson,
  inCreationOrder,
  packageBytes,
  packageCapIssues,
  packageDigest,
  portablePackageOf,
  type CreatedDefinition,
  type PortablePackage,
} from './portable-package.ts';

const someWords: unknown = expect.any(String);

const written: PortablePackage = {
  format: 1,
  page: 'data: {}\n',
  goals: '- id: more-orders\n',
  definitions: [
    { type: 'lookup', name: 'read-orders', source: '---\ndescription: Reads\n---\n', overview: 'Reads', paused: false },
    { type: 'workflow', name: 'take-orders', source: 'document: {}\n', diagram: 'flowchart', paused: true },
  ],
};

describe('a portable package', () => {
  it('is written as JSON with its keys in one order, leaving out what is absent', () => {
    expect(canonicalJson({ b: [2, { d: 1, c: undefined, a: 'x' }], a: null })).toBe(
      '{"a":null,"b":[2,{"a":"x","d":1}]}',
    );
  });

  it('keeps only the parts of a package and of each definition', () => {
    const widened = {
      ...written,
      title: 'Not carried',
      definitions: written.definitions.map((definition) => ({ ...definition, created_at: '2026-01-01T00:00:00Z' })),
    };
    expect(portablePackageOf(widened)).toEqual(written);
    expect(portablePackageOf({ format: 1, definitions: [] })).toEqual({ format: 1, definitions: [] });
  });

  it('has a digest that its order of keys and its extra fields do not change, and its content does', () => {
    const reordered: PortablePackage = {
      definitions: [
        {
          paused: false,
          source: '---\ndescription: Reads\n---\n',
          overview: 'Reads',
          name: 'read-orders',
          type: 'lookup',
        },
        { diagram: 'flowchart', paused: true, name: 'take-orders', source: 'document: {}\n', type: 'workflow' },
      ],
      goals: '- id: more-orders\n',
      format: 1,
      page: 'data: {}\n',
    };
    expect(packageDigest(reordered)).toBe(packageDigest(written));
    expect(packageDigest(written)).toMatch(/^[0-9a-f]{64}$/u);
    expect(packageDigest({ ...written, page: 'data: { more: 1 }\n' })).not.toBe(packageDigest(written));
  });
});

describe('the size of a portable package', () => {
  it('is measured in the bytes of its canonical JSON', () => {
    expect(packageBytes({ format: 1, definitions: [] })).toBe('{"definitions":[],"format":1}'.length);
    expect(packageBytes({ format: 1, page: 'é', definitions: [] })).toBe(
      '{"definitions":[],"format":1,"page":"é"}'.length + 1,
    );
  });

  it('holds at most a hundred definitions and a megabyte', () => {
    expect(packageCapIssues(written)).toEqual([]);
    const many = Array.from({ length: PORTABLE_MAX_DEFINITIONS + 1 }, (_, index) => ({
      type: 'computation',
      name: `step-${index}`,
      source: 'x'.repeat(PORTABLE_MAX_BYTES / 100),
      paused: false,
    }));
    expect(packageCapIssues({ format: 1, definitions: many })).toEqual([
      { pointer: '/definitions', detail: someWords },
      {
        pointer: '',
        detail: `A package is at most 1048576 bytes, and this one is ${packageBytes({ format: 1, definitions: many })}`,
      },
    ]);
  });
});

describe('the order of creation', () => {
  it('puts functions before workflows, each by when it was created, then by type and name', () => {
    const ordered = inCreationOrder([
      { type: 'workflow', name: 'b-flow', created_at: '2026-01-01T00:00:00Z' },
      { type: 'workflow', name: 'a-flow', created_at: '2026-01-03T00:00:00Z' },
      { type: 'lookup', name: 'read', created_at: '2026-01-02T00:00:00Z' },
      { type: 'computation', name: 'work', created_at: '2026-01-02T00:00:00Z' },
      { type: 'computation', name: 'add', created_at: '2026-01-02T00:00:00Z' },
      { type: 'computation', name: 'add', created_at: '2026-01-02T00:00:00Z' },
      { type: 'reasoning', name: 'think', created_at: '2026-01-04T00:00:00Z' },
    ]);
    expect(ordered.map(({ type, name }: Readonly<CreatedDefinition>) => `${type}/${name}`)).toEqual([
      'computation/add',
      'computation/add',
      'computation/work',
      'lookup/read',
      'reasoning/think',
      'workflow/b-flow',
      'workflow/a-flow',
    ]);
  });
});
