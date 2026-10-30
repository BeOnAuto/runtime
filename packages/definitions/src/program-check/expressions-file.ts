export interface CheckedExpression {
  readonly source: string;
  readonly names: readonly string[];
}

export interface Span {
  readonly index: number;
  readonly first: number;
  readonly lines: number;
  readonly opening: number;
  readonly closing: number;
  readonly names: readonly string[];
}

export interface ExpressionsFile {
  readonly text: string;
  readonly spans: readonly Span[];
}

const opening = '  return (';

const closing = '  )';

function headerOf(index: number, names: readonly string[]): string {
  return `export function expression${index}(${names.map((name) => `${name}: any`).join(', ')}): unknown {`;
}

export function expressionsFileOf(expressions: readonly CheckedExpression[]): ExpressionsFile {
  const parts: string[] = [];
  let length = 0;
  let line = 1;
  const spans = expressions.map(({ source, names }, index): Span => {
    const header = `${headerOf(index, names)}\n${opening}\n`;
    const start = length + header.length - 2;
    const sourceLines = source.split('\n').length;
    const text = `${header}${source}\n${closing};\n}\n`;
    const span = {
      index,
      first: line + 2,
      lines: sourceLines,
      opening: start,
      closing: length + header.length + source.length + 1 + closing.length,
      names,
    };
    parts.push(text);
    length += text.length;
    line += sourceLines + 4;
    return span;
  });
  return { text: parts.join(''), spans };
}
