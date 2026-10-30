import { once } from 'node:events';

import { spawnForTheTest } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { workflow } from '../testing/workflows.ts';

const greeting = workflow('do:\n  - greet: { set: { greeting: hello } }\n  - answer: { set: { answered: true } }');

const usingTheSdk = [
  `const { buildGraph, Classes, convertToMermaidCode, validate } = await import(${JSON.stringify(import.meta.resolve('@openworkflowspec/sdk'))});`,
  `const workflow = Classes.Workflow.deserialize(${JSON.stringify(JSON.stringify(greeting))}, { validate: false });`,
  'const nodes = buildGraph(workflow).nodes.map(({ id }) => id);',
  'const mermaid = convertToMermaidCode(workflow);',
  "const validation = (() => { try { validate('Workflow', workflow); return 'passed'; } catch (error) { return String(error); } })();",
  'process.stdout.write(JSON.stringify({ nodes, mermaid, validation }));',
].join('\n');

const useOf = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ nodes: Schema.Array(Schema.String), mermaid: Schema.String, validation: Schema.String }),
  ),
);

interface Ended {
  readonly exitCode: number | null;
  readonly printed: string;
}

async function theSdkUsedWith(flags: readonly string[]): Promise<Ended> {
  const child = spawnForTheTest(process.execPath, [...flags, '--input-type=module', '--eval', usingTheSdk], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const output = { printed: '' };
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    output.printed += chunk;
  });
  await once(child, 'close');
  return { exitCode: child.exitCode, printed: output.printed };
}

const flowchart: unknown = expect.stringMatching(/^flowchart TD\n/u);

describe('the SDK of the specification', () => {
  it('loads where no code may be generated from strings, hydrates a workflow, builds its graph and writes its Mermaid there as anywhere else, and refuses only to validate', async () => {
    const anywhere = await theSdkUsedWith([]);
    const withoutCodeFromStrings = await theSdkUsedWith(['--disallow-code-generation-from-strings']);

    expect([anywhere.exitCode, withoutCodeFromStrings.exitCode]).toEqual([0, 0]);
    expect(useOf(anywhere.printed)).toEqual({
      nodes: ['root-entry-node', 'root-exit-node', '/do/greet', '/do/answer'],
      mermaid: flowchart,
      validation: 'passed',
    });
    expect(useOf(withoutCodeFromStrings.printed)).toEqual({
      ...useOf(anywhere.printed),
      validation:
        "DslValidationError: Validation failed at '<root>' (Workflow): Code generation from strings disallowed for this context",
    });
  });
});
