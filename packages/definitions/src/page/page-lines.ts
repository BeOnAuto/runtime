export type DocumentWrittenIn = 'workflow' | 'function';

export function writtenInOf(type: string): DocumentWrittenIn {
  return type === 'workflow' ? 'workflow' : 'function';
}

const frontMatterDelimiter = /^---[ \t]*\r?$/u;

const pageKey = /^page[ \t]*:/u;

const topLevel = /^\S/u;

interface Span {
  readonly from: number;
  readonly to: number;
}

function yamlSpan(lines: readonly string[], writtenIn: DocumentWrittenIn): Span {
  if (writtenIn === 'workflow') {
    return { from: 0, to: lines.length };
  }
  const opens = frontMatterDelimiter.test(String(lines[0]));
  const closing = lines.findIndex((line, index) => index > 0 && frontMatterDelimiter.test(line));
  return opens && closing !== -1 ? { from: 1, to: closing } : { from: 0, to: 0 };
}

function pageLinesIn(source: string, writtenIn: DocumentWrittenIn): Span | undefined {
  const lines = source.split('\n');
  const { from, to } = yamlSpan(lines, writtenIn);
  const key = lines.findIndex((line, index) => index >= from && index < to && pageKey.test(line));
  if (key === -1) {
    return undefined;
  }
  const next = lines.findIndex((line, index) => index > key && index < to && topLevel.test(line));
  return { from: key, to: next === -1 ? to : next };
}

export function withoutThePage(source: string, writtenIn: DocumentWrittenIn): string {
  const span = pageLinesIn(source, writtenIn);
  if (span === undefined) {
    return source;
  }
  return source
    .split('\n')
    .map((line, index) => (index >= span.from && index < span.to ? '' : line))
    .join('\n');
}
