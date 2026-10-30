import { LiquidError, UndefinedVariableError } from 'liquidjs';

export interface EngineFailure {
  readonly line: number;
  readonly message: string;
  readonly cause: unknown;
  readonly missingVariable: string | undefined;
}

const positionSuffix = /, line:\d+, col:\d+$/u;

const undefinedVariable = /^undefined variable: /u;

export type LineOfOffset = (offset: number) => number;

function lineAt(position: readonly number[], firstLine: number): number {
  return firstLine + Number(position[0]) - 1;
}

export function linesOf(text: string, firstLine: number): LineOfOffset {
  const breaks: number[] = [];
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) {
    breaks.push(at);
  }
  return (offset) => {
    let low = 0;
    let high = breaks.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (Number(breaks[middle]) < offset) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return firstLine + low;
  };
}

export function engineFailureOf(error: unknown, firstLine: number): EngineFailure {
  if (error instanceof LiquidError) {
    const message = error.message.replace(positionSuffix, '');
    return {
      line: lineAt(error.token.getPosition(), firstLine),
      message,
      cause: error.originalError,
      missingVariable: error instanceof UndefinedVariableError ? message.replace(undefinedVariable, '') : undefined,
    };
  }
  return { line: firstLine, message: String(error), cause: error, missingVariable: undefined };
}
