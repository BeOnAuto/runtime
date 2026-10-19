import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, makeDefinitionOperations } from '../index.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { probe } from '../testing/capabilities/probe.ts';

const operations = makeDefinitionOperations([echo, probe().capability]).map(({ registration }) => registration);

const onRuns = new Set(['get_run', 'cancel_run', 'list_runs', 'get_run_history', 'get_playbook_analytics']);

const takingAType = operations.filter(({ name }) => !onRuns.has(name));

function described(name: string): string {
  return String(operations.find((operation) => operation.name === name)?.description);
}

describe('the description of create_definition', () => {
  it('names each definition type the playbook runs and the kind of definition it is', () => {
    expect(described('create_definition')).toContain(
      "`type` is the definition's type and `name` is how workflows and tools refer to it: echo, a greeting; probe, a probe.",
    );
  });
});

describe('the kind of definition create_definition names', () => {
  it('takes an before a kind that begins with a vowel', () => {
    const outlining = defineCapability({
      type: 'outlining',
      title: 'Outlining',
      guide: { name: 'outline' },
      noun: { one: 'outline', other: 'outlines' },
      describeOutput: () => 'It outlined.',
      mediaType: 'text/plain',
      parse: () => Effect.succeed({}),
      summarize: () => ({}),
      run: () => Effect.succeed({ output: null, record: {} }),
    });
    const createDefinition = makeDefinitionOperations([outlining]).find(
      ({ registration }) => registration.name === 'create_definition',
    );

    expect(createDefinition?.registration.description).toContain('outlining, an outline.');
  });
});

describe('the description of every operation', () => {
  it('stays under 800 characters', () => {
    expect(operations.filter(({ description }) => description.length >= 800)).toEqual([]);
  });

  it('carries no format and no catalogue of refusals', () => {
    expect(operations.filter(({ description }) => /Rejected with|^---$|```/mu.test(description))).toEqual([]);
  });
});

describe('the JSON Schema of the input of the operations', () => {
  it('lists the known capabilities for the capability field as a plain enum, which alone names them', () => {
    for (const { input } of takingAType) {
      expect(input.schema).toHaveProperty(['properties', 'type'], {
        type: 'string',
        enum: ['echo', 'probe'],
        description: "The definition's type",
      });
      expect(input.schema).toMatchObject({ type: 'object', additionalProperties: false });
    }
  });

  it('keeps every other field of the input as its schema gives it', () => {
    expect(operations[1]?.input.schema).toHaveProperty(['properties', 'include_retired'], {
      type: 'boolean',
      description: 'Whether to list retired definitions as well; false when left out',
    });
    expect(operations[2]?.input.schema).toHaveProperty('required', ['type', 'name']);
  });

  it('holds a definition name to its pattern and a document to at most 65536 characters', () => {
    expect(operations[0]?.input.schema).toMatchObject({
      properties: {
        name: { type: 'string', pattern: '^[a-z][a-z0-9-]{2,47}$' },
        source: { type: 'string', maxLength: 65_536 },
      },
      required: ['type', 'name', 'source'],
    });
  });

  it('takes any JSON value as the input of a run, and a UUID as its id', () => {
    expect(operations[5]?.input.schema).toMatchObject({
      properties: {
        input: {
          description:
            'The run input: any JSON value the definition takes, {} when left out, at most 262144 bytes as JSON in UTF-8 and 512 levels deep',
        },
        run_id: { type: 'string', format: 'uuid' },
      },
      required: ['type', 'name'],
    });
    expect(operations[6]?.input.schema).toMatchObject({
      properties: { run_id: { type: 'string', format: 'uuid' } },
      required: ['run_id'],
    });
  });
});

describe('the JSON Schema of the filters of the runs', () => {
  it('describes the runs a filter keeps', () => {
    const listing = operations.find(({ name }) => name === 'list_runs');

    expect(listing?.input.schema).toMatchObject({
      properties: {
        type: {
          description: 'Only the runs of this type',
        },
        name: { description: 'Only the runs of the definition with this name' },
      },
    });
  });
});

describe('what the operations declare of a repeated call', () => {
  it('declares retiring a definition and cancelling a run irreversible, and updating and retiring repeatable', () => {
    const declared = Object.fromEntries(
      operations
        .filter(({ kind }) => kind === 'command')
        .map(({ name, irreversible, repeatable }) => [name, { irreversible, repeatable }]),
    );

    expect(declared).toEqual({
      create_definition: { irreversible: false, repeatable: false },
      update_definition: { irreversible: false, repeatable: true },
      retire_definition: { irreversible: true, repeatable: true },
      run_definition: { irreversible: false, repeatable: false },
      cancel_run: { irreversible: true, repeatable: true },
    });
  });
});
