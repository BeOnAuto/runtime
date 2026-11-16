import { audienceOfASpan, spanClosing, unknownAudienceIn } from './audience.ts';
import { holdsAMarking, markingsWrittenIn, placedFrom, type Cell, type Placed, type Token } from './page-tokens.ts';
import { faultAt, faultedAt, readingsJoined, unknownForm, unread, type Reading } from './reading.ts';
import { cellStartsOf, linesOf, offsetWritten, type Line } from './written-lines.ts';

export interface Context {
  readonly page: string;
  readonly place: (offset: number) => number;
}

interface Opened {
  readonly at: number;
  readonly raw: string;
}

interface SpanScan extends Reading {
  readonly open: Opened | undefined;
}

interface Span {
  readonly start: number;
  readonly end: number;
  readonly raw: string;
}

function faulted(scan: SpanScan, context: Context, at: number, fault: string): SpanScan {
  return {
    edits: scan.edits,
    faults: [...scan.faults, faultAt(context.page, context.place(at), fault)],
    open: undefined,
  };
}

function closed(scan: SpanScan, span: Span, context: Context): SpanScan {
  if (span.raw.includes('\n')) {
    return faulted(scan, context, span.start, 'runs a marked span over more than one line.');
  }
  const start = context.place(span.start);
  const end = context.place(span.end);
  if (context.page.slice(start, end) !== span.raw) {
    return faulted(scan, context, span.start, unread);
  }
  return { edits: [...scan.edits, { start, end, words: '' }], faults: scan.faults, open: undefined };
}

function stepWithin(scan: SpanScan, open: Opened, { token, at }: Placed, context: Context): SpanScan {
  const raw = `${open.raw}${token.raw}`;
  if (token.type === 'html' && token.raw === spanClosing) {
    return closed(scan, { start: open.at, end: at + token.raw.length, raw }, context);
  }
  if (token.type === 'html' || holdsAMarking(token)) {
    return faulted(scan, context, open.at, 'holds HTML or another marking inside a marked span.');
  }
  return { ...scan, open: { at: open.at, raw } };
}

function opened(scan: SpanScan, { token, at }: Placed, context: Context): SpanScan {
  const audience = audienceOfASpan(token.raw);
  if (audience === undefined) {
    return markingsWrittenIn(token.raw) > 0 ? faulted(scan, context, at, unknownForm) : scan;
  }
  const unknown = unknownAudienceIn(audience);
  const faults =
    unknown === undefined ? scan.faults : [...scan.faults, faultAt(context.page, context.place(at), unknown)];
  return { edits: scan.edits, faults, open: { at, raw: token.raw } };
}

function stepOver(scan: SpanScan, placed: Placed, context: Context): SpanScan {
  if (scan.open !== undefined) {
    return stepWithin(scan, scan.open, placed, context);
  }
  if (placed.token.type === 'html') {
    return opened(scan, placed, context);
  }
  return holdsAMarking(placed.token)
    ? faulted(scan, context, placed.at, 'marks a passage inside emphasis or a link, where a guide does not read it.')
    : scan;
}

function spansOfInline(tokens: readonly Token[], at: number, context: Context): Reading {
  const scan = placedFrom(tokens, at).reduce<SpanScan>((reading, placed) => stepOver(reading, placed, context), {
    edits: [],
    faults: [],
    open: undefined,
  });
  return scan.open === undefined
    ? { edits: scan.edits, faults: scan.faults }
    : faulted(scan, context, scan.open.at, 'opens a marked span and does not close it on the same line.');
}

function spansOfRow(cells: readonly Cell[], line: Line, context: Context): Reading {
  return readingsJoined(
    cellStartsOf(line.text).flatMap((start, column) =>
      cells
        .slice(column, column + 1)
        .filter(({ tokens }) => tokens.some((token) => holdsAMarking(token)))
        .map(({ tokens }) => spansOfInline(tokens, line.start + start, context)),
    ),
  );
}

function spansOfTable({ raw, header, rows }: Token, at: number, context: Context): Reading {
  const lines = linesOf(raw, at).filter((_line, index) => index !== 1);
  const cells = [header, ...rows];
  return readingsJoined(
    lines.flatMap((line, row) => cells.slice(row, row + 1).map((written) => spansOfRow(written, line, context))),
  );
}

function spansOfItem({ raw, text, tokens }: Token, at: number, context: Context): Reading {
  const inItem: Context = {
    page: context.page,
    place: (offset) => context.place(at + offsetWritten(raw, text, offset)),
  };
  return readingsJoined(
    placedFrom(tokens, 0)
      .filter(({ token }) => holdsAMarking(token))
      .map(({ token, at: within }) => spansOf(token, within, inItem)),
  );
}

export function spansOf(token: Token, at: number, context: Context): Reading {
  switch (token.type) {
    case 'paragraph':
    case 'text': {
      return spansOfInline(token.tokens, at, context);
    }
    case 'table': {
      return spansOfTable(token, at, context);
    }
    case 'list': {
      return readingsJoined(
        placedFrom(token.items, at)
          .filter((item) => holdsAMarking(item.token))
          .map((item) => spansOfItem(item.token, item.at, context)),
      );
    }
    default: {
      return faultedAt(
        context.page,
        context.place(at),
        `marks a passage inside a ${token.type}, where a guide does not read it: mark a paragraph, a list item or a table cell.`,
      );
    }
  }
}
