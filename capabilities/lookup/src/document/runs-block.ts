import { definitionNamePattern, definitionTypeOrder } from '@on.auto/definitions';
import { issueAt, type DocumentIssue, type SourceLines } from '@on.auto/definitions/document';
import { parsedTemplate, type RenderClock } from '@on.auto/definitions/template';
import {
  nameIssues,
  placeOf,
  sampleMoment,
  templateIssues,
  toolBlockEngine,
  type TemplateSet,
} from '@on.auto/definitions/tool-blocks';
import { alternatives } from '@on.auto/phrasing';
import { Result, type Schema } from 'effect';

import type { WrittenRuns } from './front-matter.ts';
import type { RunsBlock, WrittenText } from './lookup-document.ts';
import { sinceProblem, wordsProblem } from './runs-bounds.ts';

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

type LiteralProblem = (text: string) => string | undefined;

export interface WrittenPlace {
  readonly lines: SourceLines;
  readonly clock: RenderClock;
  readonly inputSchema: Schema.JsonObject | undefined;
}

const runsTemplates: TemplateSet = {
  names: ['input', 'today', 'now'],
  what: 'a template of runs',
  sample: { today: sampleMoment.slice(0, 10), now: sampleMoment },
  structured: 'input',
};

const typeShape = `the type of a definition: ${alternatives(definitionTypeOrder)}`;

const nameShape = 'the name of a definition: 3 to 48 lowercase letters, digits and hyphens, starting with a letter';

function isDefinitionType(type: string): boolean {
  return definitionTypeOrder.includes(type);
}

function isDefinitionName(name: string): boolean {
  return definitionNamePattern.test(name);
}

function isLiteral(text: string): boolean {
  return !text.includes('{{') && !text.includes('{%');
}

function issuesOf(check: () => Checked<unknown>): readonly DocumentIssue[] {
  const checked = check();
  return Result.isFailure(checked) ? checked.failure : [];
}

function writtenTextOf(
  text: string,
  pointer: string,
  place: WrittenPlace,
  problem: LiteralProblem,
): Checked<WrittenText> {
  const { lines, clock, inputSchema } = place;
  const atThePointer = (found: readonly { readonly line: number; readonly detail: string }[]) =>
    found.map(({ line, detail }) => ({ line, pointer, detail }));
  const parsed = parsedTemplate(toolBlockEngine, text, issueAt(lines, pointer, '').line);
  return Result.flatMap(Result.mapError(parsed, atThePointer), (template) => {
    const found = templateIssues(runsTemplates, text, { lines, pointer, inputSchema, clock });
    const literal = found.length === 0 && isLiteral(text) ? problem(text) : undefined;
    const issues = literal === undefined ? found : [issueAt(lines, pointer, literal)];
    return issues.length > 0 ? Result.fail(issues) : Result.succeed({ pointer, template });
  });
}

function writtenOrNot<Part>(text: string | undefined, part: (text: string) => Checked<Part>): Checked<Partial<Part>> {
  return text === undefined ? Result.succeed({}) : part(text);
}

export function runsBlockOf(written: WrittenRuns, place: WrittenPlace): Checked<RunsBlock> {
  const { type, name } = written;
  const words = writtenOrNot(written.words, (text) =>
    Result.map(writtenTextOf(text, placeOf('runs', 'words'), place, wordsProblem), (parsed) => ({ words: parsed })),
  );
  const since = writtenOrNot(written.since, (text) =>
    Result.map(writtenTextOf(text, placeOf('runs', 'since'), place, sinceProblem), (parsed) => ({ since: parsed })),
  );
  const issues = [
    ...nameIssues(place.lines, [[placeOf('runs', 'type'), type]], isDefinitionType, typeShape),
    ...nameIssues(place.lines, [[placeOf('runs', 'name'), name]], isDefinitionName, nameShape),
    ...issuesOf(() => words),
    ...issuesOf(() => since),
  ];
  return issues.length > 0
    ? Result.fail(issues)
    : Result.map(Result.all({ words, since }), (texts) => ({ type, name, ...texts.words, ...texts.since }));
}
