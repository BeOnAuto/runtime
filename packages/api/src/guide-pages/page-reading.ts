import { audienceOfABlock, blockClosing, unknownAudienceIn } from './audience.ts';
import { spansOf, type Context } from './marked-spans.ts';
import {
  everyTokenOf,
  holdsAMarking,
  lexed,
  markingsWrittenIn,
  placedFrom,
  rawsOf,
  type Placed,
  type Token,
} from './page-tokens.ts';
import { faultAt, readingsJoined, unknownForm, type Reading } from './reading.ts';

interface Opened {
  readonly at: number;
}

interface BlockScan extends Reading {
  readonly open: Opened | undefined;
}

interface Here {
  readonly index: number;
  readonly placed: Placed;
}

interface Page {
  readonly text: string;
  readonly placed: readonly Placed[];
}

function isSpace(page: Page, index: number): boolean {
  return page.placed.slice(index, index + 1).some(({ token }) => token.type === 'space');
}

function isEdge(page: Page, index: number): boolean {
  return index < 0 || index >= page.placed.length || isSpace(page, index);
}

function isAComment({ type, raw }: Token): boolean {
  return type === 'html' && raw.startsWith('<!--') && markingsWrittenIn(raw) === 0;
}

function faulted(scan: BlockScan, page: Page, at: number, fault: string): BlockScan {
  return { ...scan, faults: [...scan.faults, faultAt(page.text, at, fault)] };
}

function opened(scan: BlockScan, page: Page, { index, placed }: Here, audience: string): BlockScan {
  const faults = [
    ...(scan.open === undefined ? [] : ['opens a marked passage inside another.']),
    ...[unknownAudienceIn(audience)].filter((fault) => fault !== undefined),
    ...(isEdge(page, index - 1) && isSpace(page, index + 1)
      ? []
      : ['writes a marked passage whose opening line is not set apart by blank lines.']),
  ];
  const faulty = faults.reduce((reading, fault) => faulted(reading, page, placed.at, fault), scan);
  return scan.open === undefined ? { ...faulty, open: { at: placed.at } } : faulty;
}

function closed(scan: BlockScan, page: Page, { index, placed }: Here, open: Opened): BlockScan {
  const end = page.placed
    .slice(index + 1, index + 2)
    .filter(({ token }) => token.type === 'space')
    .reduce((_end, { token, at }) => at + token.raw.length, placed.at + placed.token.raw.length);
  const ended: BlockScan = {
    edits: [...scan.edits, { start: open.at, end, words: '' }],
    faults: scan.faults,
    open: undefined,
  };
  return isSpace(page, index - 1) && isEdge(page, index + 1)
    ? ended
    : faulted(ended, page, placed.at, 'writes a marked passage whose closing line is not set apart by blank lines.');
}

function stepInside(scan: BlockScan, page: Page, here: Here, open: Opened): BlockScan {
  const { token, at } = here.placed;
  if (token.type === 'html' && token.raw.trimEnd() === blockClosing) {
    return closed(scan, page, here, open);
  }
  if (isAComment(token)) {
    return scan;
  }
  if (token.type === 'html' || holdsAMarking(token)) {
    return faulted(scan, page, at, 'holds HTML or another marking inside a marked passage.');
  }
  return scan;
}

function step(scan: BlockScan, page: Page, here: Here): BlockScan {
  const { token, at } = here.placed;
  const audience = token.type === 'html' ? audienceOfABlock(token.raw.trimEnd()) : undefined;
  if (audience !== undefined) {
    return opened(scan, page, here, audience);
  }
  if (scan.open !== undefined) {
    return stepInside(scan, page, here, scan.open);
  }
  return token.type === 'html' && markingsWrittenIn(token.raw) > 0 ? faulted(scan, page, at, unknownForm) : scan;
}

function blocksOf(page: Page): BlockScan {
  const scan = page.placed.reduce<BlockScan>((reading, placed, index) => step(reading, page, { index, placed }), {
    edits: [],
    faults: [],
    open: undefined,
  });
  return scan.open === undefined
    ? scan
    : faulted(scan, page, scan.open.at, 'opens a marked passage and never closes it with a line that is </div>.');
}

function spansOfPage(page: Page, holding: readonly Placed[], blocks: Reading): Reading {
  const context: Context = { page: page.text, place: (offset) => offset };
  const isInABlock = (at: number): boolean => blocks.edits.some(({ start, end }) => at >= start && at < end);
  return readingsJoined(
    holding
      .filter(({ token, at }) => token.type !== 'html' && !isInABlock(at) && holdsAMarking(token))
      .map(({ token, at }) => spansOf(token, at, context)),
  );
}

function codeHoldingMarkings(page: Page, holding: readonly Placed[]): Reading {
  return {
    edits: [],
    faults: holding
      .filter(({ token }) =>
        everyTokenOf([token]).some((each) => each.type === 'code' && markingsWrittenIn(each.raw) > 0),
      )
      .map(({ at }) =>
        faultAt(page.text, at, 'writes a marking inside a code example, which a guide shows as it is written.'),
      ),
  };
}

function markingsAccountedIn(token: Token): number {
  return everyTokenOf([token])
    .filter(({ type }) => type === 'html' || type === 'code' || type === 'codespan')
    .reduce((count, { raw }) => count + markingsWrittenIn(raw), 0);
}

function markingsUnread(page: Page, holding: readonly Placed[]): Reading {
  return {
    edits: [],
    faults: holding
      .filter(({ token }) => markingsWrittenIn(token.raw) > markingsAccountedIn(token))
      .map(({ at }) =>
        faultAt(page.text, at, 'writes a marking where the Markdown parser reads it as text, not as an element.'),
      ),
  };
}

export function readingOf(text: string): Reading {
  if (markingsWrittenIn(text) === 0) {
    return { edits: [], faults: [] };
  }
  const tokens = lexed(text);
  if (rawsOf(tokens) !== text) {
    return {
      edits: [],
      faults: ['The page cannot be read: the Markdown parser does not account for every character of it.'],
    };
  }
  const page: Page = { text, placed: placedFrom(tokens, 0) };
  const blocks = blocksOf(page);
  const holding = page.placed.filter(({ token }) => markingsWrittenIn(token.raw) > 0);
  return readingsJoined([
    blocks,
    spansOfPage(page, holding, blocks),
    codeHoldingMarkings(page, holding),
    markingsUnread(page, holding),
  ]);
}
