import { describe, expect, it } from 'vitest';

import { needsOf, portableExportOf } from './portable-export.ts';
import { packageDigest, type PortableDefinition } from './portable-package.ts';
import { findingId } from './value-scan.ts';

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
