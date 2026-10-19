import { markdownLinesOf, standsApart, type OpenBlock } from '../markdown/markdown-lines.ts';
import { readableName } from '../plain-language/in-words.ts';
import { paragraph, type Paragraph, type Phrase, type Phrases } from './overview.ts';

type Place = 'prose' | 'cell';

export type Part = 'body' | 'appendix';

interface TitledName {
  readonly name: string;
  readonly title?: string;
}

export interface UnclosedBlock {
  readonly line: number;
  readonly kind: 'fence' | 'html';
  readonly closer: string;
}

interface FirstParagraph {
  readonly text: string;
  readonly endsInProse: boolean;
}

export const detailsHeading = '## Details';

const inlinePunctuation = /[\\`*[\]<>]/gu;

const underscoreAtAWordBoundary = /(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu;

const cellPunctuation = /[\\`|]/gu;

const backtickRuns = /`+/gu;

const blankLine = /^[ \t]*$/u;

const hardBreak = '\\';

const wordsBefore = 'Words: ';

export function oneLine(text: string): string {
  const lines = text.split('\n');
  const last = lines.length - 1;
  return lines
    .map((line, index) => {
      const ended = index < last ? line.trimEnd() : line;
      return index > 0 ? ended.trimStart() : ended;
    })
    .filter((line, index) => index === 0 || index === last || line !== '')
    .join(' ');
}

export function escapedInline(text: string): string {
  return oneLine(text).trim().replaceAll(inlinePunctuation, '\\$&').replaceAll(underscoreAtAWordBoundary, '\\_');
}

function codeSpan(text: string): string {
  const line = oneLine(text);
  const longestRun = Math.max(0, ...(line.match(backtickRuns) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longestRun + 1);
  const padded = line.startsWith('`') || line.endsWith('`') ? ` ${line} ` : line;
  return `${fence}${padded}${fence}`;
}

function withPipesEscaped(text: string, place: Place): string {
  return place === 'cell' ? text.replaceAll('|', '\\|') : text;
}

function writtenText(text: string, place: Place): string {
  return place === 'cell' ? oneLine(text).replaceAll(cellPunctuation, '\\$&') : text;
}

function boldText(text: string, place: Place): string {
  return `**${withPipesEscaped(escapedInline(text), place)}**`;
}

function readableOf({ name, title }: TitledName): string {
  return title ?? readableName(name);
}

function definitionText(definition: TitledName, place: Place, part: Part): string {
  return part === 'appendix'
    ? withPipesEscaped(codeSpan(definition.name), place)
    : boldText(readableOf(definition), place);
}

function phraseText(phrase: Phrase, place: Place, part: Part): string {
  if (typeof phrase === 'string') {
    return writtenText(phrase, place);
  }
  if ('name' in phrase) {
    return boldText(phrase.name, place);
  }
  if ('emphasis' in phrase) {
    return `*${withPipesEscaped(escapedInline(phrase.emphasis), place)}*`;
  }
  if ('definition' in phrase) {
    return definitionText(phrase.definition, place, part);
  }
  if ('server' in phrase) {
    return boldText(phrase.server, place);
  }
  return withPipesEscaped(codeSpan(phrase.code), place);
}

export function phrasesText(phrases: Phrases, place: Place, part: Part): string {
  return phrases.map((phrase) => phraseText(phrase, place, part)).join('');
}

function plainTextOfPhrase(phrase: Phrase): string {
  if (typeof phrase === 'string') {
    return phrase;
  }
  if ('name' in phrase) {
    return phrase.name;
  }
  if ('emphasis' in phrase) {
    return phrase.emphasis;
  }
  if ('definition' in phrase) {
    return readableOf(phrase.definition);
  }
  return 'server' in phrase ? phrase.server : phrase.code;
}

export function plainTextOf(phrases: Phrases): string {
  return phrases.map((phrase) => plainTextOfPhrase(phrase)).join('');
}

function hardBreaksOf(lines: readonly string[]): readonly boolean[] {
  const prose = markdownLinesOf(lines).reads.map((read) => read.prose);
  const goesOn = lines.map((line, index) => prose[index] === true && !standsApart(line));
  return lines.map((line, index) => prose[index] === true && goesOn[index + 1] === true && !line.endsWith(hardBreak));
}

export function blockQuoted(lines: readonly string[]): string {
  const hardBreaks = hardBreaksOf(lines);
  return lines
    .map((line, index) => (blankLine.test(line) ? '>' : `> ${line}${hardBreaks[index] === true ? hardBreak : ''}`))
    .join('\n');
}

function makesAHeading({ form }: { readonly form: string | undefined }): boolean {
  return form === 'atx' || form === 'underline';
}

export function headingLinesIn(text: string): readonly number[] {
  const { reads } = markdownLinesOf(text.split('\n'));
  return reads.flatMap((read, index) => (makesAHeading(read) ? [index] : []));
}

function isClosedByTheBlankLineAfterIt({ within, kind }: OpenBlock): boolean {
  return within !== undefined || kind === 'element' || kind === 'tag';
}

function unclosedOf(open: OpenBlock | undefined): UnclosedBlock | undefined {
  if (open === undefined || isClosedByTheBlankLineAfterIt(open)) {
    return undefined;
  }
  return { line: open.line, kind: open.kind === 'fence' ? 'fence' : 'html', closer: open.closer };
}

export function unclosedBlockIn(text: string): UnclosedBlock | undefined {
  return unclosedOf(markdownLinesOf(text.split('\n')).open);
}

export function detailsLinesIn(text: string): readonly number[] {
  return text.split('\n').flatMap((line, index) => (line === detailsHeading ? [index] : []));
}

function withDetailsLinesEscaped(phrase: Phrase, startsALine: boolean): Phrase {
  if (typeof phrase !== 'string') {
    return phrase;
  }
  return phrase
    .split('\n')
    .map((line, index) => (line === detailsHeading && (index > 0 || startsALine) ? `\\${line}` : line))
    .join('\n');
}

export function paragraphsAsWritten(paragraphs: readonly Paragraph[]): readonly Paragraph[] {
  const escaped = paragraphs.map(({ phrases }) =>
    paragraph(...phrases.map((phrase, index) => withDetailsLinesEscaped(phrase, index === 0))),
  );
  const unclosed = unclosedBlockIn(escaped.map(({ phrases }) => phrasesText(phrases, 'prose', 'body')).join('\n\n'));
  const last = escaped.at(-1);
  if (unclosed === undefined || last === undefined) {
    return escaped;
  }
  return [...escaped.slice(0, -1), paragraph(...last.phrases, `\n${unclosed.closer}`)];
}

export function firstParagraphOf(text: string): FirstParagraph {
  const placed = `${wordsBefore}${text}`.split('\n');
  const { reads, open } = markdownLinesOf(placed);
  const unclosed = unclosedOf(open);
  const end = Math.min(
    ...[
      reads.findIndex((read) => read.separates),
      reads.findIndex((read) => makesAHeading(read)),
      unclosed === undefined ? -1 : unclosed.line,
    ].map((index) => (index < 0 ? placed.length : index)),
  );
  return {
    text: text.split('\n').slice(0, end).join('\n'),
    endsInProse: reads.slice(end - 1, end).some((read) => read.prose),
  };
}
