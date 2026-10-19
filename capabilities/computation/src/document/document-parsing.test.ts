import { issueText } from '@on.auto/definitions/document';
import { shapeNamed } from '@on.auto/definitions/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { campaignPace } from '../testing/campaign-pace.ts';
import { functionOf, programDocument } from '../testing/computation-runs.ts';
import type { ComputationFunctionDefinitionDocument } from './computation-document.ts';
import { parseComputationDocument } from './document-parsing.ts';
function parsed(source: string): ComputationFunctionDefinitionDocument {
  return Result.getOrThrow(parseComputationDocument(source));
}

function issuesIn(source: string): readonly string[] {
  return Result.match(parseComputationDocument(source), {
    onSuccess: () => [],
    onFailure: (issues) => issues.map((issue) => issueText(issue)),
  });
}

describe('a computation function definition', () => {
  it('is front matter of the keys of a reason function that apply, language, and a program as its body', () => {
    const document = parsed(campaignPace);

    expect(document).toMatchObject({
      description: 'Spend, pace and projection per campaign, in cents, for a reporting period',
      language: 'typescript',
      input: { schema: { document: { type: 'object', required: ['rows', 'period'] } } },
      output: { schema: { document: { type: 'object', required: ['campaigns', 'total_spend_cents'] } } },
      programLine: 19,
    });
    expect(document.program.startsWith('export default function (input: Input): Output {\n')).toBe(true);
  });

  it('needs only a language and a program, and takes a schema of any value', () => {
    expect(parsed(programDocument(functionOf('return input + 1;')))).toEqual({
      language: 'typescript',
      input: {},
      output: {},
      program: functionOf('return input + 1;'),
      programLine: 4,
    });
    expect(
      parsed(programDocument(functionOf('return input;'), 'language: typescript\ninput: {schema: {type: integer}}'))
        .input.schema?.document,
    ).toEqual({ type: 'integer' });
  });
});

describe('the output of a computation function that names a shape', () => {
  it('is the shape, with its schema as the output schema', () => {
    const shape = shapeNamed('series');
    const { output } = parsed(
      programDocument(functionOf('return input;'), 'language: typescript\noutput: {shape: series}'),
    );

    expect(output).toMatchObject({ schema: { document: shape.schema }, shape });
  });

  it('is refused beside a schema of its own, or for a name no shape has', () => {
    expect(
      ['output:\n  shape: series\n  schema: {type: object}', 'output:\n  shape: chart'].map((output) =>
        issuesIn(programDocument(functionOf('return input;'), `language: typescript\n${output}`)),
      ),
    ).toEqual([
      ["Line 5, /output/schema: An output that names a shape takes no schema: the shape's schema is its schema"],
      ['Line 4, /output/shape: Expected the name of a shape: series, categories, table, or text'],
    ]);
  });
});

describe('the front matter of a computation function definition', () => {
  it('names at least the language, and opens the document', () => {
    expect(issuesIn(programDocument(functionOf('return input;'), '# nothing'))).toEqual([
      'Line 2: The front matter is empty; it names at least the language',
    ]);
    expect(issuesIn(functionOf('return input;'))).toEqual([
      'Line 1: A computation function definition starts with a line of three dashes (---) that opens its front matter of YAML',
    ]);
    expect(issuesIn(programDocument(functionOf('return input;'), 'description: Adds one'))).toEqual([
      'Line 2, /language: language is required',
    ]);
  });

  it('refuses the keys of a reason function that do not apply, as keys it does not take', () => {
    expect(
      issuesIn(
        programDocument(
          functionOf('return input;'),
          'language: typescript\nmodel: anthropic/claude-sonnet-4-5\nconfig: {temperature: 0}\ntools: [graph/*]\ninput: {default: {}}\noutput: {format: json}',
        ),
      ),
    ).toEqual([
      'Line 3, /model: model is not a key of the front matter; it takes description, about, language, input, output',
      'Line 4, /config: config is not a key of the front matter; it takes description, about, language, input, output',
      'Line 5, /tools: tools is not a key of the front matter; it takes description, about, language, input, output',
      'Line 6, /input/default: default is not a key of input; it takes schema',
      'Line 7, /output/format: format is not a key of output; it takes schema, shape',
    ]);
  });
});

describe('the values in the front matter of a computation function definition', () => {
  it('refuses a language other than TypeScript, and a schema that is not a JSON Schema, with their line', () => {
    expect(
      issuesIn(
        programDocument(
          functionOf('return input;'),
          'language: python\ninput:\n  schema: {type: object, properties: {a: {pattern: "x"}}}\noutput:\n  schema: {type: wrong}',
        ),
      ),
    ).toEqual([
      "Line 2, /language: The playbook's one language is TypeScript; write the program as a TypeScript function",
      'Line 4, /input/schema/properties/a/pattern: Regular expressions are not accepted, because a hostile pattern can stall validation',
      'Line 6, /output/schema/type: Expected one of null, boolean, object, array, number, string, integer, or a non-empty list of them',
    ]);
  });

  it('is checked with the program, whose issues it reports beside its own', () => {
    expect(issuesIn(programDocument('  ', 'language: typescript\nsize: 2'))).toEqual([
      'Line 3, /size: size is not a key of the front matter; it takes description, about, language, input, output',
      'Line 5: The definition has no program: write it after the front matter',
    ]);
    expect(issuesIn('---\nlanguage: [typescript\n---\n')).toEqual([
      'Line 2: Flow sequence in block collection must be sufficiently indented and end with a ]',
      'Line 4: The definition has no program: write it after the front matter',
    ]);
  });
});

describe('the program of a computation function definition', () => {
  it('is there', () => {
    expect(issuesIn(programDocument('\n  \n'))).toEqual([
      'Line 4: The definition has no program: write it after the front matter',
    ]);
  });

  it('is read as it is written, its types and its mistakes left to the check at save', () => {
    expect(
      parsed(programDocument('export default function (input: Input): Output {\n  return input.perod;\n}')).program,
    ).toBe('export default function (input: Input): Output {\n  return input.perod;\n}');
  });
});

describe('the about of a computation function definition', () => {
  it('is kept as its author wrote it', () => {
    const frontMatter = 'language: typescript\nabout: |\n  The finance team reads it.';

    expect(parsed(programDocument(functionOf('return input;'), frontMatter)).about).toBe(
      'The finance team reads it.\n',
    );
  });

  it('takes no heading, nor does the description, each refused at its line', () => {
    const frontMatter =
      "language: typescript\ndescription: '# Adds one'\nabout: |\n  The finance team reads it.\n  ---";

    expect(issuesIn(programDocument(functionOf('return input;'), frontMatter))).toEqual([
      'Line 3, /description: description takes no heading, since an overview writes its own: the line that begins “# Adds one” makes one, with # before its words or as a line of = or - under the words above it',
      'Line 6, /about: about takes no heading, since an overview writes its own: this line makes one, with # before its words or as a line of = or - under the words above it',
    ]);
  });
});
