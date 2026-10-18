import { readableName } from '../plain-language/in-words.ts';
import type { Phrase, Phrases } from './overview.ts';

type Place = 'prose' | 'cell';

export type Part = 'body' | 'appendix';

interface TitledName {
  readonly name: string;
  readonly title?: string;
}

type HtmlBlock = 'raw' | 'comment' | 'instruction' | 'declaration' | 'data' | 'element';

interface LineReading {
  readonly fence: string | undefined;
  readonly html: HtmlBlock | undefined;
  readonly codeMayStart: boolean;
  readonly inCode: boolean;
}

interface ReadLine {
  readonly reading: LineReading;
  readonly prose: boolean;
}

const inlinePunctuation = /[\\`*[\]<>]/gu;

const underscoreAtAWordBoundary = /(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu;

const cellPunctuation = /[\\`|]/gu;

const backtickRuns = /`+/gu;

const blankLine = /^[ \t]*$/u;

const indentedCode = /^(?: {4}|\t)/u;

const fenceLine = /^[ \t]*(?<marker>`{3,}|~{3,})(?<rest>.*)$/u;

const listItem = /^[ \t]*(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/u;

const quoteMarker = /^[ \t]*>/u;

const headingLine = /^[ \t]*#{1,6}(?:[ \t]|$)/u;

const thematicBreak = /^[ \t]*(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/u;

const setextUnderline = /^[ \t]*(?:=+|-+)[ \t]*$/u;

const delimiterCell = /^:?-+:?$/u;

const outerPipes = /^\||\|$/gu;

const blockTags = [
  ['address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption', 'center', 'col'],
  ['colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure'],
  ['footer', 'form', 'frame', 'frameset', 'h[1-6]', 'head', 'header', 'hr', 'html', 'iframe', 'legend'],
  ['li', 'link', 'main', 'menu', 'menuitem', 'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param'],
  ['search', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul'],
].flat();

const htmlBlocks: readonly HtmlBlock[] = ['raw', 'comment', 'instruction', 'declaration', 'data', 'element'];

const htmlOpeners: Readonly<Record<HtmlBlock, RegExp>> = {
  raw: /^[ \t]*<(?:script|pre|style|textarea)(?:[ \t>]|$)/iu,
  comment: /^[ \t]*<!--/u,
  instruction: /^[ \t]*<\?/u,
  declaration: /^[ \t]*<![A-Za-z]/u,
  data: /^[ \t]*<!\[CDATA\[/u,
  element: new RegExp(`^[ \\t]*</?(?:${blockTags.join('|')})(?:[ \\t>]|/>|$)`, 'iu'),
};

const htmlEnds: Readonly<Record<HtmlBlock, RegExp>> = {
  raw: /<\/(?:script|pre|style|textarea)>/iu,
  comment: /--!?>/u,
  instruction: /\?>/u,
  declaration: />/u,
  data: /\]\]>/u,
  element: blankLine,
};

const hardBreak = '\\';

const atRest: LineReading = { fence: undefined, html: undefined, codeMayStart: true, inCode: false };

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

function closesFence(line: string, opened: string): boolean {
  const { marker = '', rest = '' } = fenceLine.exec(line)?.groups ?? {};
  return marker.startsWith(opened.charAt(0)) && marker.length >= opened.length && rest.trim() === '';
}

function htmlBlockOpenedBy(line: string): HtmlBlock | undefined {
  return htmlBlocks.find((html) => htmlOpeners[html].test(line));
}

function standsAlone(line: string): boolean {
  return headingLine.test(line) || thematicBreak.test(line) || setextUnderline.test(line);
}

function insideFence(fence: string, line: string): LineReading {
  return closesFence(line, fence) ? atRest : { ...atRest, fence, codeMayStart: false };
}

function insideHtml(html: HtmlBlock, line: string): LineReading {
  return htmlEnds[html].test(line) ? atRest : { ...atRest, html, codeMayStart: false };
}

function outsideBlocks({ codeMayStart, inCode }: LineReading, line: string): ReadLine {
  if (blankLine.test(line)) {
    return { reading: { ...atRest, inCode }, prose: false };
  }
  if ((codeMayStart || inCode) && indentedCode.test(line)) {
    return { reading: { ...atRest, inCode: true }, prose: false };
  }
  const fence = fenceLine.exec(line)?.groups?.['marker'];
  if (fence !== undefined) {
    return { reading: { ...atRest, fence, codeMayStart: false }, prose: false };
  }
  const html = htmlBlockOpenedBy(line);
  if (html !== undefined) {
    return { reading: insideHtml(html, line), prose: false };
  }
  const alone = standsAlone(line);
  return { reading: { ...atRest, codeMayStart: alone }, prose: !alone };
}

function readLine(reading: LineReading, line: string): ReadLine {
  if (reading.fence !== undefined) {
    return { reading: insideFence(reading.fence, line), prose: false };
  }
  if (reading.html !== undefined) {
    return { reading: insideHtml(reading.html, line), prose: false };
  }
  return outsideBlocks(reading, line);
}

function isDelimiterRow(line: string | undefined): boolean {
  const cells = line?.trim().replaceAll(outerPipes, '').split('|') ?? [];
  return line?.includes('|') === true && cells.every((cell) => delimiterCell.test(cell.trim()));
}

function tableLinesOf(lines: readonly string[]): readonly boolean[] {
  let within = false;
  return lines.map((line, index) => {
    within = within ? !blankLine.test(line) : line.includes('|') && isDelimiterRow(lines.at(index + 1));
    return within;
  });
}

function proseLinesOf(lines: readonly string[]): readonly boolean[] {
  const inTable = tableLinesOf(lines);
  let reading = atRest;
  return lines.map((line, index) => {
    const read = readLine(reading, line);
    reading = read.reading;
    return read.prose && inTable[index] === false;
  });
}

function opensAContainer(line: string): boolean {
  return listItem.test(line) || quoteMarker.test(line);
}

function hardBreaksOf(lines: readonly string[]): readonly boolean[] {
  const prose = proseLinesOf(lines);
  const goesOn = lines.map((line, index) => prose[index] === true && !opensAContainer(line));
  return lines.map((line, index) => prose[index] === true && goesOn[index + 1] === true && !line.endsWith(hardBreak));
}

export function blockQuoted(lines: readonly string[]): string {
  const hardBreaks = hardBreaksOf(lines);
  return lines
    .map((line, index) => (blankLine.test(line) ? '>' : `> ${line}${hardBreaks[index] === true ? hardBreak : ''}`))
    .join('\n');
}
