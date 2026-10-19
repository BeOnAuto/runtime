import { blockQuoted, detailsHeading, escapedInline, oneLine, phrasesText, type Part } from './markdown-text.ts';
import { mermaidOf } from './mermaid-diagram.ts';
import {
  decodedOverview,
  named,
  type FieldRow,
  type FieldTable,
  type Overview,
  type OverviewBlock,
  type OverviewSection,
  type Phrases,
  type Quote,
} from './overview.ts';

export const mostOverviewBytes = 65_536;

const counted = new Intl.NumberFormat('en');

const cutLine = `*The overview stops here, at the ${counted.format(mostOverviewBytes)} bytes an overview may take; the whole definition is under Source.*`;

const blockSeparator = '\n\n';

const utf8 = new TextEncoder();

interface Within {
  readonly kept: readonly string[];
  readonly cut: boolean;
}

function bytesOf(text: string): number {
  return utf8.encode(text).byteLength;
}

function tableRow(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function fieldRow({ name, required, words }: FieldRow, part: Part): string {
  return tableRow([
    phrasesText([named(name)], 'cell', part),
    required ? 'yes' : 'no',
    phrasesText(words, 'cell', part).trim(),
  ]);
}

function fieldTableText({ rows, more }: FieldTable, part: Part): string {
  return [
    tableRow(['Field', 'Required', 'What it is']),
    tableRow(['---', '---', '---']),
    ...rows.map((row) => fieldRow(row, part)),
    ...(more === undefined ? [] : [tableRow([`and ${more} more`, '', ''])]),
  ].join('\n');
}

function itemsText(items: readonly Phrases[], markerOf: (index: number) => string, part: Part): string {
  return items
    .map((item, index) => `${markerOf(index)} ${oneLine(phrasesText(item, 'prose', part)).trim()}`)
    .join('\n');
}

function quoteText({ lines }: Quote, part: Part): string {
  return blockQuoted(lines.flatMap((line) => phrasesText(line, 'prose', part).split('\n')));
}

function blockText(block: OverviewBlock, part: Part): string {
  if (block.kind === 'paragraph') {
    return phrasesText(block.phrases, 'prose', part);
  }
  if (block.kind === 'list') {
    return itemsText(block.items, () => '-', part);
  }
  if (block.kind === 'numbered') {
    return itemsText(block.items, (index) => `${index + 1}.`, part);
  }
  if (block.kind === 'quote') {
    return quoteText(block, part);
  }
  if (block.kind === 'authored') {
    return block.text;
  }
  return block.kind === 'fields' ? fieldTableText(block, part) : mermaidOf(block);
}

function blocksWithin(blocks: readonly string[]): Within {
  if (bytesOf(blocks.join(blockSeparator)) + 1 <= mostOverviewBytes) {
    return { kept: blocks, cut: false };
  }
  const room = mostOverviewBytes - 1 - bytesOf(cutLine) - blockSeparator.length;
  const kept: string[] = [];
  let taken = 0;
  for (const block of blocks) {
    taken += bytesOf(block) + (kept.length > 0 ? blockSeparator.length : 0);
    if (taken > room) {
      break;
    }
    kept.push(block);
  }
  return { kept, cut: true };
}

function withCutLine({ kept, cut }: Within): readonly string[] {
  return cut ? [...kept, cutLine] : kept;
}

function sectionText({ heading, blocks }: OverviewSection, level: string, part: Part): readonly string[] {
  return [`${level} ${escapedInline(heading)}`, ...blocks.map((block) => blockText(block, part))];
}

function headingsOf(appendix: readonly OverviewSection[]): ReadonlySet<number> {
  const headings = new Set([0]);
  let at = 1;
  for (const { blocks } of appendix) {
    headings.add(at);
    at += 1 + blocks.length;
  }
  return headings;
}

function withoutLoneHeadings(kept: readonly string[], from: number, headings: ReadonlySet<number>): readonly string[] {
  let end = kept.length;
  while (end > from && headings.has(end - 1 - from)) {
    end -= 1;
  }
  return kept.slice(0, end);
}

function detailsWithin(story: readonly string[], appendix: readonly OverviewSection[]): Within {
  const detailed = appendix.filter(({ blocks }) => blocks.length > 0);
  if (detailed.length === 0) {
    return blocksWithin(story);
  }
  const details = detailed.flatMap((section) => sectionText(section, '###', 'appendix'));
  const { kept, cut } = blocksWithin([...story, detailsHeading, ...details]);
  return { kept: withoutLoneHeadings(kept, story.length, headingsOf(detailed)), cut };
}

export function markdownOf({ title, opening, body, sections, appendix }: Overview): string {
  const story = [
    `# ${escapedInline(title)}`,
    phrasesText(opening, 'prose', 'body'),
    ...body.map((block) => blockText(block, 'body')),
    ...sections.flatMap((section) => sectionText(section, '##', 'body')),
  ];
  return `${withCutLine(detailsWithin(story, appendix)).join(blockSeparator)}\n`;
}

export function markdownOfKept(kept: unknown): string {
  return markdownOf(decodedOverview(kept));
}
