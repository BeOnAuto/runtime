import { htmlCloserOf, htmlEnds, htmlOpenedBy, type HtmlBlock } from './html-blocks.ts';
import { tableLinesOf } from './table-rows.ts';

export interface OpenBlock {
  readonly kind: 'fence' | HtmlBlock;
  readonly closer: string;
  readonly line: number;
  readonly within: number | undefined;
}

type Form = 'atx' | 'underline' | 'break';

interface ReadLine {
  readonly prose: boolean;
  readonly text: boolean;
  readonly form: Form | undefined;
  readonly separates: boolean;
  readonly container: string;
  readonly quoted: number;
}

interface Reading {
  readonly open: OpenBlock | undefined;
  readonly codeMayStart: boolean;
  readonly inCode: boolean;
  readonly items: readonly number[];
  readonly startedEmpty: boolean;
  readonly last: ReadLine | undefined;
}

interface Stripped {
  readonly quoted: number;
  readonly opens: readonly number[];
  readonly at: number;
  readonly rest: string;
  readonly container: string;
}

interface Place {
  readonly quoted: number;
  readonly kept: readonly number[];
  readonly opens: readonly number[];
  readonly container: string;
  readonly indent: number;
  readonly content: string;
}

interface Step {
  readonly reading: Reading;
  readonly read: ReadLine;
}

interface BlockLine {
  readonly block: boolean;
  readonly open: OpenBlock | undefined;
}

export interface MarkdownLines {
  readonly reads: readonly ReadLine[];
  readonly open: OpenBlock | undefined;
}

const blankLine = /^[ \t]*$/u;

const leadingBlanks = /^[ \t]+/u;

const fenceOpener = /^(?:`{3,}(?=[^`]*$)|~{3,})/u;

const listMarker = /^(?:[-+*]|\d{1,9}[.)])(?=[ \t]|$)/u;

const interruptingItem = /^(?:[-+*]|0*1[.)])[ \t]+[^ \t]/u;

const quoteMarker = /^ {0,3}> ?/u;

const atxHeading = /^#{1,6}(?:[ \t]|$)/u;

const thematicBreak = /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/u;

const setextUnderline = /^(?:=+|-+)[ \t]*$/u;

const atRest: Reading = {
  open: undefined,
  codeMayStart: true,
  inCode: false,
  items: [],
  startedEmpty: false,
  last: undefined,
};

function blanksOf(line: string): string {
  return line.slice(0, line.length - line.replace(leadingBlanks, '').length);
}

function withoutBlanks(line: string): string {
  return line.slice(blanksOf(line).length);
}

function columnsOf(blanks: string, from = 0): number {
  return blanks
    .split('')
    .reduce((column, character) => (character === '\t' ? column + 4 - (column % 4) : column + 1), from);
}

function fromColumn(line: string, column: number): string {
  let reached = 0;
  let index = 0;
  while (reached < column && (line[index] === ' ' || line[index] === '\t')) {
    reached = columnsOf(line.charAt(index), reached);
    index += 1;
  }
  return line.slice(index);
}

function opensAnItem(rest: string, interrupting: boolean): boolean {
  const content = withoutBlanks(rest);
  const item = listMarker.test(content) && !thematicBreak.test(content);
  return columnsOf(blanksOf(rest)) <= 3 && item && (!interrupting || interruptingItem.test(content));
}

function itemOf(rest: string, at: number): Pick<Stripped, 'at' | 'rest'> {
  const marker = rest.length - rest.replace(listMarker, '').length;
  const spaces = blanksOf(rest.slice(marker));
  const width = columnsOf(spaces, at + marker) - at - marker;
  const taken = rest.length === marker + spaces.length || width > 4 ? 1 : width;
  return { at: at + marker + taken, rest: rest.slice(marker + Math.min(spaces.length, taken)) };
}

function strippedOnce(stripped: Stripped, paragraph: string | undefined): Stripped | undefined {
  const { rest, at, quoted } = stripped;
  const quote = quoteMarker.exec(rest)?.[0];
  if (quote !== undefined) {
    return { ...stripped, quoted: quoted + 1, rest: rest.slice(quote.length), container: `${stripped.container}>` };
  }
  if (!opensAnItem(rest, paragraph === stripped.container)) {
    return undefined;
  }
  const item = itemOf(withoutBlanks(rest), columnsOf(blanksOf(rest), at));
  const opens = quoted === 0 ? [...stripped.opens, item.at] : stripped.opens;
  return { ...stripped, ...item, opens, container: `${stripped.container}-${item.at}` };
}

function placeOf(line: string, items: readonly number[], paragraph: string | undefined): Place {
  const kept = items.filter((column) => column <= columnsOf(blanksOf(line)));
  const at = kept.at(-1) ?? 0;
  const container = kept.map((column) => `-${column}`).join('');
  let stripped: Stripped = { quoted: 0, opens: [], at, rest: fromColumn(line, at), container };
  for (let next = strippedOnce(stripped, paragraph); next !== undefined; next = strippedOnce(next, paragraph)) {
    stripped = next;
  }
  const { quoted, opens, rest } = stripped;
  const content = withoutBlanks(rest);
  return { quoted, kept, opens, container: stripped.container, indent: columnsOf(blanksOf(rest)), content };
}

function opensABlock(content: string): boolean {
  const opensAContainer = listMarker.test(content) || quoteMarker.test(content);
  const standsAlone = atxHeading.test(content) || thematicBreak.test(content) || fenceOpener.test(content);
  return opensAContainer || standsAlone || htmlOpenedBy(content, true) !== undefined;
}

export function standsApart(line: string): boolean {
  const content = withoutBlanks(line);
  return opensABlock(content) || setextUnderline.test(content);
}

function isParagraphText(place: Place): boolean {
  return place.opens.length === 0 && (place.indent > 3 || !opensABlock(place.content));
}

function lazilyAfter(last: ReadLine | undefined, place: Place, items: readonly number[]): ReadLine | undefined {
  if (last?.prose !== true || place.quoted > last.quoted || !isParagraphText(place)) {
    return undefined;
  }
  return place.quoted < last.quoted || place.kept.length < items.length ? last : undefined;
}

function lineOf({ quoted }: Pick<Place, 'quoted'>, container: string, kind: Form | 'prose' | 'other'): ReadLine {
  const form = kind === 'prose' || kind === 'other' ? undefined : kind;
  return { prose: kind === 'prose', text: kind === 'prose', form, separates: false, container, quoted };
}

function htmlLineOf(content: string, interrupting: boolean, at: Omit<OpenBlock, 'kind' | 'closer'>): BlockLine {
  const html = htmlOpenedBy(content, interrupting);
  if (html === undefined) {
    return { block: false, open: undefined };
  }
  const open = { kind: html, closer: htmlCloserOf(html, content), ...at };
  return { block: true, open: htmlEnds[html].test(content) ? undefined : open };
}

function blockLineOf(place: Place, interrupting: boolean, at: Omit<OpenBlock, 'kind' | 'closer'>): BlockLine {
  if (place.indent > 3 || place.quoted > 0) {
    return { block: false, open: undefined };
  }
  const closer = fenceOpener.exec(place.content)?.[0];
  return closer === undefined
    ? htmlLineOf(place.content, interrupting, at)
    : { block: true, open: { kind: 'fence', closer, ...at } };
}

function stepOf(reading: Reading, read: ReadLine, changes: Partial<Reading>): Step {
  return { reading: { ...reading, startedEmpty: false, ...changes, last: read }, read };
}

function formOf({ content }: Place, underlines: boolean): Form | undefined {
  if (atxHeading.test(content)) {
    return 'atx';
  }
  if (underlines && setextUnderline.test(content)) {
    return 'underline';
  }
  return thematicBreak.test(content) ? 'break' : undefined;
}

function kindOf(place: Place, block: boolean, underlines: boolean): Form | 'prose' | 'other' {
  if (block) {
    return 'other';
  }
  return (place.indent <= 3 ? formOf(place, underlines) : undefined) ?? 'prose';
}

function isUnderAParagraphOf(last: ReadLine | undefined, container: string): boolean {
  return last?.prose === true && last.container === container;
}

function containedStep(reading: Reading, place: Place, line: number): Step {
  const items = [...place.kept, ...place.opens];
  const within = items.at(-1);
  const { container } = place;
  const codeMayStart = reading.codeMayStart || reading.inCode || place.opens.length > 0;
  if (codeMayStart && place.indent >= 4 && place.quoted === 0) {
    return stepOf(reading, lineOf(place, container, 'other'), { codeMayStart: true, inCode: true, items });
  }
  const { block, open } = blockLineOf(place, reading.last?.text === true, { line, within });
  const kind = kindOf(place, block, isUnderAParagraphOf(reading.last, container));
  const changes = { open, codeMayStart: kind !== 'prose', inCode: false, items };
  return stepOf(reading, lineOf(place, container, kind), changes);
}

function blankStep(reading: Reading, place: Place): Step {
  const startedEmpty = place.opens.length > 0;
  const going = reading.startedEmpty ? reading.items.slice(0, -1) : reading.items;
  const items = startedEmpty || place.quoted > 0 ? [...place.kept, ...place.opens] : going;
  return stepOf(
    reading,
    { ...lineOf(place, '', 'other'), separates: true },
    { codeMayStart: true, items, startedEmpty },
  );
}

function readOutside(reading: Reading, line: string, index: number): Step {
  const { last } = reading;
  const place = placeOf(line, reading.items, last?.prose === true ? last.container : undefined);
  if (blankLine.test(place.content)) {
    return blankStep(reading, place);
  }
  const above = lazilyAfter(reading.last, place, reading.items);
  if (above !== undefined) {
    const read = lineOf(above, above.container, 'prose');
    return stepOf(reading, read, { codeMayStart: false, inCode: false });
  }
  return containedStep(reading, place, index);
}

function closesFence({ closer, within }: OpenBlock, line: string): boolean {
  const rest = fromColumn(line, within ?? 0);
  const content = withoutBlanks(rest);
  const closing = fenceOpener.exec(content)?.[0] ?? '';
  const fits = closing.startsWith(closer.charAt(0)) && closing.length >= closer.length;
  return columnsOf(blanksOf(rest)) <= 3 && fits && blankLine.test(content.slice(closing.length));
}

function readInside(reading: Reading, open: OpenBlock, line: string): Step | undefined {
  if (open.within !== undefined && !blankLine.test(line) && columnsOf(blanksOf(line)) < open.within) {
    return undefined;
  }
  const closes = open.kind === 'fence' ? closesFence(open, line) : htmlEnds[open.kind].test(line);
  const separates = closes && blankLine.test(line);
  const read: ReadLine = { prose: false, text: false, form: undefined, separates, container: '', quoted: 0 };
  return stepOf(reading, read, { open: closes ? undefined : open, codeMayStart: closes });
}

function readLine(reading: Reading, line: string, index: number): Step {
  const inside = reading.open === undefined ? undefined : readInside(reading, reading.open, line);
  return inside ?? readOutside({ ...reading, open: undefined }, line, index);
}

export function markdownLinesOf(lines: readonly string[]): MarkdownLines {
  const inTable = tableLinesOf(lines);
  let reading = atRest;
  const reads = lines.map((line, index) => {
    const step = readLine(reading, line, index);
    const read = { ...step.read, prose: step.read.prose && inTable[index] === false };
    reading = { ...step.reading, last: read };
    return read;
  });
  return { reads, open: reading.open };
}
