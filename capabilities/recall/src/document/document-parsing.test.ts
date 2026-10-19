import { issueText } from '@on.auto/definitions/document';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { campaignReviews, foldOf, recallDocument } from '../testing/campaign-reviews.ts';
import { parseRecallDocument } from './document-parsing.ts';
import type { RecallFunctionDefinitionDocument } from './recall-document.ts';

const succeeded = 'language: typescript\nsource:\n  events:\n    - type: run_succeeded';

const adding = foldOf('return view + 1;');

function parsed(source: string): RecallFunctionDefinitionDocument {
  return Result.getOrThrow(parseRecallDocument(source));
}

function issuesIn(source: string): readonly string[] {
  return Result.match(parseRecallDocument(source), {
    onSuccess: () => [],
    onFailure: (issues) => issues.map((issue) => issueText(issue)),
  });
}

describe('a recall function definition', () => {
  it('is front matter of the keys of a reason function that apply, language, source and view, and a module as its body', () => {
    const document = parsed(campaignReviews);

    expect(document).toMatchObject({
      description: 'The reviews of each campaign, latest last, as the review-brief function wrote them',
      language: 'typescript',
      input: { schema: { document: { type: 'object', required: ['campaign'] } } },
      output: { schema: { document: { type: 'array' } } },
      answers: true,
    });
    expect(document.details).toMatchObject({
      language: 'typescript',
      fold: campaignReviews.split('---\n')[2],
      foldLine: 29,
      filters: [{ type: 'run_succeeded', subject: 'reasoning/review-brief' }],
      initial: {},
      schema: { type: 'object', maxProperties: 50 },
    });
  });

  it('needs only a language, the events it folds and a fold, and starts its view at null', () => {
    expect(parsed(recallDocument(adding))).toEqual({
      language: 'typescript',
      input: {},
      output: {},
      answers: false,
      filterExpressions: [],
      details: {
        language: 'typescript',
        fold: adding,
        foldLine: 7,
        filters: [{ type: 'run_succeeded' }],
        initial: null,
      },
    });
  });
});

describe('the front matter of a recall function definition', () => {
  it('names at least the language and the events it folds, and opens the document', () => {
    expect(issuesIn(recallDocument(adding, '# nothing'))).toEqual([
      'Line 2: The front matter is empty; it names at least the language and the events it folds',
    ]);
    expect(issuesIn(adding)).toEqual([
      'Line 1: A recall function definition starts with a line of three dashes (---) that opens its front matter of YAML',
    ]);
    expect(issuesIn(recallDocument(adding, 'language: typescript'))).toEqual(['Line 2, /source: source is required']);
    expect(issuesIn(recallDocument(adding, 'source: {events: [{type: x}]}'))).toEqual([
      'Line 2, /language: language is required',
    ]);
  });

  it('refuses the keys of a reason function that do not apply, as keys it does not take', () => {
    const front = `${succeeded}\nmodel: anthropic/claude-sonnet-4-5\nconfig: {temperature: 0}\ntools: [graph/*]\ninput: {default: {}}\noutput: {format: json}\nview: {limit: 3}\nsource2: x`;

    expect(issuesIn(recallDocument(adding, front))).toEqual([
      'Line 6, /model: model is not a key of the front matter; it takes description, about, language, source, view, input, output',
      'Line 7, /config: config is not a key of the front matter; it takes description, about, language, source, view, input, output',
      'Line 8, /tools: tools is not a key of the front matter; it takes description, about, language, source, view, input, output',
      'Line 9, /input/default: default is not a key of input; it takes schema',
      'Line 10, /output/format: format is not a key of output; it takes schema',
      'Line 11, /view/limit: limit is not a key of view; it takes initial, schema',
      'Line 12, /source2: source2 is not a key of the front matter; it takes description, about, language, source, view, input, output',
    ]);
    expect(issuesIn(recallDocument(adding, `${succeeded}\nanswer: '.'`))).toEqual([
      'Line 6, /answer: answer is not a key of the front matter; it takes description, about, language, source, view, input, output',
    ]);
  });

  it('refuses a language other than TypeScript, and a schema that is not a JSON Schema, with their line', () => {
    const front =
      'language: python\nsource:\n  events:\n    - type: x\ninput:\n  schema: {type: object, properties: {a: {pattern: "x"}}}\noutput:\n  schema: {type: wrong}\nview:\n  schema: {minimum: 1}';

    expect(issuesIn(recallDocument(adding, front))).toEqual([
      "Line 2, /language: The playbook's one language is TypeScript; write the program as a TypeScript function",
      'Line 7, /input/schema/properties/a/pattern: Regular expressions are not accepted, because a hostile pattern can stall validation',
      'Line 9, /output/schema/type: Expected one of null, boolean, object, array, number, string, integer, or a non-empty list of them',
    ]);
  });
});

describe('the view of a recall function definition', () => {
  it('starts at an initial value that fits its bounds and its schema', () => {
    const deep = `${'['.repeat(80)}${']'.repeat(80)}`;
    const large = `"${'x'.repeat(600_000)}"`;

    expect(issuesIn(recallDocument(adding, `${succeeded}\nview: {initial: ${deep}}`))).toEqual([
      `Line 6, /view/initial${'/0'.repeat(71)}: The front matter may nest at most 72 levels`,
    ]);
    expect(issuesIn(recallDocument(adding, `${succeeded}\nview: {initial: ${large}}`))).toEqual([
      'Line 6, /view/initial: initial takes 600002 bytes as JSON, more than the 524288 a view may',
    ]);
    expect(issuesIn(recallDocument(adding, `${succeeded}\nview: {initial: [1], schema: {type: object}}`))).toEqual([
      "Line 6, /view/initial: initial does not match the view's schema at its root: Expected object",
    ]);
    expect(
      issuesIn(
        recallDocument(adding, `${succeeded}\nview: {initial: {a: 1}, schema: {properties: {a: {type: string}}}}`),
      ),
    ).toEqual(["Line 6, /view/initial: initial does not match the view's schema at /a: Expected string"]);
  });

  it('starts at a value JSON can hold', () => {
    expect(issuesIn(recallDocument(adding, `${succeeded}\nview: {initial: .nan}`))).toEqual([
      'Line 6, /view/initial: Expected text, a finite number, true, false or null',
    ]);
  });
});

describe('the module of a recall function definition', () => {
  it('is there', () => {
    expect(issuesIn(recallDocument('\n  \n'))).toEqual([
      'Line 7: The definition has no program: write the module with its fold after the front matter',
    ]);
  });

  it('answers with its view unless it exports a function answer', () => {
    expect(parsed(recallDocument(foldOf('return view + 1;', 'return view;'))).answers).toBe(true);
    expect(parsed(recallDocument(`${adding}\nfunction answer(): number {\n  return 1;\n}`)).answers).toBe(false);
  });

  it('is read as it is written, its types and its mistakes left to the check at save', () => {
    expect(
      parsed(recallDocument('export function fold(view: View, event: Event): View {\n  return view.perod;\n}')).details
        .fold,
    ).toBe('export function fold(view: View, event: Event): View {\n  return view.perod;\n}');
  });
});

describe('the about of a recall function definition', () => {
  it('is kept as its author wrote it', () => {
    expect(parsed(recallDocument(adding, `${succeeded}\nabout: |\n  The campaign team asks it.`)).about).toBe(
      'The campaign team asks it.\n',
    );
  });

  it('takes no heading, nor does the description, each refused at its line', () => {
    const written = `${succeeded}\ndescription: '# Reviews'\nabout: |\n  The campaign team asks it.\n\n  ## When`;

    expect(issuesIn(recallDocument(adding, written))).toEqual([
      'Line 6, /description: description takes no heading, since an overview writes its own: the line that begins “# Reviews” makes one, with # before its words or as a line of = or - under the words above it',
      'Line 10, /about: about takes no heading, since an overview writes its own: this line makes one, with # before its words or as a line of = or - under the words above it',
    ]);
  });
});
