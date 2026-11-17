import { describe, expect, it } from 'vitest';

import { defineCapability, makeDefinitionOperations } from '../index.ts';
import { echo, echoDeclaration } from '../testing/capabilities/echo.ts';
import { echoingWorkflow } from '../testing/capabilities/paged.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { runContentHolders } from '../testing/harness.ts';
import { uncheckedPages } from '../testing/page-ports.ts';

const operations = makeDefinitionOperations([echo, probe().capability], uncheckedPages, {
  holders: runContentHolders,
}).map(({ registration }) => registration);

const takingNoType = new Set([
  'render_playbook_page',
  'get_run',
  'cancel_run',
  'list_runs',
  'get_run_history',
  'get_playbook_analytics',
]);

const takingAType = operations.filter(({ name }) => !takingNoType.has(name));

function described(name: string): string {
  return String(operations.find((operation) => operation.name === name)?.description);
}

describe('the description of create_definition', () => {
  it('says that a workflow is designed before its functions and each step that does work calls a function of the type that work needs, and leaves the types to the argument', () => {
    expect(described('create_definition')).toContain(
      'update_definition changes one saved, and a name is never reused. A workflow, designed before its functions, owns one job the business does again and again; a check, a test or a setup is not one. Each step that does work calls a function of the `type` that work needs, by its `name`.',
    );
  });
});

function createDefinitionDescribed(capabilities: Parameters<typeof makeDefinitionOperations>[0], goals: boolean) {
  return String(
    makeDefinitionOperations(
      capabilities,
      uncheckedPages,
      { holders: runContentHolders },
      { goals, messages: false },
    ).find(({ registration }) => registration.name === 'create_definition')?.registration.description,
  );
}

describe('the description of create_definition where goals are kept', () => {
  it('says first that a workflow needs its contributes list, and keeps every other sentence in under 800 characters', () => {
    const kept = createDefinitionDescribed([echo, echoingWorkflow], true);

    expect(kept.split(/(?<=[.!?])\s+(?=\S)/u)).toEqual([
      expect.any(String),
      'update_definition changes one saved, and a name is never reused.',
      expect.any(String),
      expect.any(String),
      "`source` is the whole document in its type's format, which get_guide gives, and `overview`, optional, Markdown for the person who runs the business.",
      expect.any(String),
      expect.any(String),
    ]);
    expect(kept.length).toBeLessThan(800);
  });

  it('is the description without goals where no workflow is served, and where goals are not kept', () => {
    expect(createDefinitionDescribed([echo, probe().capability], true)).toBe(described('create_definition'));
    expect(createDefinitionDescribed([echo, echoingWorkflow], false)).toBe(described('create_definition'));
  });
});

const servingReasoningAndWorkflows = makeDefinitionOperations(
  [
    defineCapability({ ...echoDeclaration, type: 'workflow' }),
    defineCapability({ ...echoDeclaration, type: 'reasoning' }),
  ],
  uncheckedPages,
  { holders: runContentHolders },
).map(({ registration }) => registration);

function typeOf(name: string): unknown {
  return servingReasoningAndWorkflows.find((operation) => operation.name === name)?.input.schema['properties'];
}

describe('the type argument of create_definition', () => {
  it('says that the workflow is the job, and by the job of a step that does work which type it takes, for each type the server serves, and the other tools keep their words', () => {
    expect(typeOf('create_definition')).toHaveProperty(['type'], {
      type: 'string',
      enum: ['reasoning', 'workflow'],
      description: 'workflow is the job; each working step, by its job: reasoning interprets, judges or writes.',
    });
    expect(typeOf('update_definition')).toHaveProperty(['type', 'description'], "The definition's type");
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
    expect(operations.find(({ name }) => name === 'run_definition')?.input.schema).toMatchObject({
      properties: {
        input: {
          description:
            'The run input: any JSON value the definition takes, {} when left out, at most 1 MiB as JSON in UTF-8 and 512 levels deep',
        },
        run_id: { type: 'string', format: 'uuid' },
      },
      required: ['type', 'name'],
    });
    expect(operations.find(({ name }) => name === 'get_run')?.input.schema).toMatchObject({
      properties: { run_id: { type: 'string', format: 'uuid' } },
      required: ['run_id'],
    });
  });
});

describe('the description of list_runs', () => {
  it('says that `cursor` is the next_cursor of the page before', () => {
    expect(described('list_runs')).toContain('`cursor` is the next_cursor of the page before.');
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
  it('declares cancelling a run irreversible, and updating, pausing, resuming, retiring and restoring repeatable, retiring no longer irreversible now that restoring undoes it', () => {
    const declared = Object.fromEntries(
      operations
        .filter(({ kind }) => kind === 'command')
        .map(({ name, irreversible, repeatable }) => [name, { irreversible, repeatable }]),
    );

    expect(declared).toEqual({
      create_definition: { irreversible: false, repeatable: false },
      update_definition: { irreversible: false, repeatable: true },
      pause_definition: { irreversible: false, repeatable: true },
      resume_definition: { irreversible: false, repeatable: true },
      retire_definition: { irreversible: false, repeatable: true },
      restore_definition: { irreversible: false, repeatable: true },
      run_definition: { irreversible: false, repeatable: false },
      cancel_run: { irreversible: true, repeatable: true },
    });
  });
});
