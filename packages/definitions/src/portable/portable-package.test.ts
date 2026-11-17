import { describe, expect, it } from 'vitest';

import { packageWithTexts, type PortableText, subjectOf, textsOfPackage } from './package-texts.ts';
import { needsOf, portableExportOf } from './portable-export.ts';
import {
  canonicalJson,
  type CreatedDefinition,
  inCreationOrder,
  packageBytes,
  packageCapIssues,
  packageDigest,
  PORTABLE_MAX_BYTES,
  PORTABLE_MAX_DEFINITIONS,
  type PortableDefinition,
  type PortablePackage,
  portablePackageOf,
} from './portable-package.ts';
import { findingId } from './value-scan.ts';

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

const writtenPackageTexts: PortablePackage = {
  format: 1,
  goals: 'goals text',
  page: 'page text',
  definitions: [
    {
      type: 'lookup',
      name: 'read',
      source: 'read source',
      overview: 'read overview',
      diagram: 'read diagram',
      paused: false,
    },
    { type: 'workflow', name: 'flow', source: 'flow source', paused: true },
  ],
};

const lookup: PortableDefinition = {
  type: 'lookup',
  name: 'read-orders',
  source: '---\ndescription: Reads the orders\ncall:\n  server: shop\n  tool: list_orders\n---\n',
  paused: false,
};

const interaction: PortableDefinition = {
  type: 'interaction',
  name: 'ask-owner',
  source:
    '---\ndescription: Asks the owner\nto: owner@example.com\ndeliver:\n  server: chat\n  tool: post_message\nreplies:\n  server: chat\n  tool: thread_replies\n---\nMay I?\n',
  paused: true,
};

const reasoning: PortableDefinition = {
  type: 'reasoning',
  name: 'write-note',
  source:
    '---\ndescription: Writes a note\nmodel: provider/model-one\ntools: [notes/search, shop/*, 7, /]\n---\nWrite it.\n',
  paused: false,
};

const workflow: PortableDefinition = {
  type: 'workflow',
  name: 'take-orders',
  source: 'document:\n  name: take-orders\ncall:\n  server: shop\n',
  paused: false,
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

describe('the texts of a package', () => {
  it('are its goals, its page and each definition source, overview and diagram, each with its place', () => {
    expect(textsOfPackage(writtenPackageTexts)).toEqual([
      { part: 'goals', text: 'goals text' },
      { part: 'page', text: 'page text' },
      { part: 'definition', name: 'lookup/read', field: 'source', text: 'read source' },
      { part: 'definition', name: 'lookup/read', field: 'overview', text: 'read overview' },
      { part: 'definition', name: 'lookup/read', field: 'diagram', text: 'read diagram' },
      { part: 'definition', name: 'workflow/flow', field: 'source', text: 'flow source' },
    ]);
    expect(textsOfPackage({ format: 1, definitions: [] })).toEqual([]);
  });

  it('name a definition by its type and name', () => {
    expect(subjectOf({ type: 'lookup', name: 'read' })).toBe('lookup/read');
  });

  it('are put back where they came from, leaving a text not given as it was', () => {
    const texts = textsOfPackage(writtenPackageTexts).map((text: PortableText) =>
      Object.assign({}, text, { text: `${text.text}!` }),
    );
    expect(packageWithTexts(writtenPackageTexts, texts)).toEqual({
      format: 1,
      goals: 'goals text!',
      page: 'page text!',
      definitions: [
        {
          type: 'lookup',
          name: 'read',
          source: 'read source!',
          overview: 'read overview!',
          diagram: 'read diagram!',
          paused: false,
        },
        { type: 'workflow', name: 'flow', source: 'flow source!', paused: true },
      ],
    });
    expect(packageWithTexts(writtenPackageTexts, [])).toEqual(writtenPackageTexts);
    expect(packageWithTexts({ format: 1, definitions: [] }, texts)).toEqual({ format: 1, definitions: [] });
  });
});

describe('what a package needs', () => {
  it('is each server its definitions name, with who names it, the types and the models', () => {
    expect(needsOf([lookup, interaction, reasoning, workflow, lookup])).toEqual({
      connections: [
        { server: 'chat', used_by: ['interaction/ask-owner'] },
        { server: 'notes', used_by: ['reasoning/write-note'] },
        { server: 'shop', used_by: ['lookup/read-orders', 'reasoning/write-note', 'workflow/take-orders'] },
      ],
      types: ['interaction', 'lookup', 'reasoning', 'workflow'],
      models: ['provider/model-one'],
    });
  });

  it('is nothing for a definition that cannot be read or holds no front matter', () => {
    expect(
      needsOf([
        { type: 'lookup', name: 'no-front', source: 'call: { server: shop }\n', paused: false },
        { type: 'lookup', name: 'broken', source: '---\ncall: [\n---\n', paused: false },
        { type: 'workflow', name: 'listed', source: '- call\n', paused: false },
        { type: 'interaction', name: 'agent', source: '---\ndeliver: agent\nmodel: ""\n---\n', paused: false },
      ]),
    ).toEqual({ connections: [], types: ['interaction', 'lookup', 'workflow'], models: [] });
  });
});

describe('an export', () => {
  it('carries the package, its digest, what it needs and its findings', () => {
    const exported = portableExportOf({
      format: 1,
      page: 'data: {}\n',
      definitions: [{ ...interaction, overview: 'Asks' }],
    });
    expect(exported).toEqual({
      format: 1,
      page: 'data: {}\n',
      definitions: [{ ...interaction, overview: 'Asks' }],
      digest: packageDigest({ format: 1, page: 'data: {}\n', definitions: [{ ...interaction, overview: 'Asks' }] }),
      needs: {
        connections: [{ server: 'chat', used_by: ['interaction/ask-owner'] }],
        types: ['interaction'],
        models: [],
      },
      findings: [
        {
          id: findingId('address', 'owner@example.com'),
          class: 'address',
          value: 'owner@example.com',
          occurrences: [{ part: 'definition', name: 'interaction/ask-owner', field: 'source', line: 3 }],
        },
      ],
    });
  });
});
