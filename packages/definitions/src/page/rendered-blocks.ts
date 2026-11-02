import { Buffer } from 'node:buffer';

import { Result, type Schema } from 'effect';
import { toValue } from 'liquidjs';

import { chartsDrawnAndLaidOut } from '../charts/rows-laid-out.ts';
import { outputText } from '../template/output-text.ts';
import type { RenderClock } from '../template/render-clock.ts';
import { templateLimits } from '../template/template-engine.ts';
import type { ParsedTemplate } from '../template/template-parsing.ts';
import { renderedTemplate, type RenderFailure } from '../template/template-rendering.ts';
import { pageEngine } from './page-templates.ts';

const mostRenderedBytes = 65_536;

class TooLong extends Error {}

interface TextEmitter {
  buffer: string;
  readonly write: (html: unknown) => void;
}

function textEmitter(): TextEmitter {
  const emitter: TextEmitter = {
    buffer: '',
    write: (html) => {
      emitter.buffer += outputText(toValue(html));
      if (Buffer.byteLength(emitter.buffer, 'utf8') > mostRenderedBytes) {
        throw new TooLong();
      }
    },
  };
  return emitter;
}

type Stopped = RenderFailure | { readonly reason: 'too_long'; readonly line: number };

function refusalOf(cause: unknown, line: number): Stopped | undefined {
  return cause instanceof TooLong ? { reason: 'too_long', line } : undefined;
}

function problemOf(stopped: Stopped): string {
  if (stopped.reason === 'missing_variable') {
    return `the value has no field ${stopped.variable}`;
  }
  if (stopped.reason === 'too_long') {
    return `the rendered block exceeds ${mostRenderedBytes} bytes`;
  }
  if (stopped.reason === 'limit_exceeded') {
    return stopped.limit === 'time'
      ? `rendering exceeded ${templateLimits.renderMilliseconds} ms`
      : `rendering exceeded ${templateLimits.memory} characters or items`;
  }
  return stopped.detail;
}

export interface Showing {
  readonly variables: Readonly<Record<string, Schema.Json>>;
  readonly clock: RenderClock;
  readonly stopped: string;
}

export function shown(parsed: ParsedTemplate, { variables, clock, stopped: stoppedWords }: Showing): string {
  const emitter = textEmitter();
  const rendered = renderedTemplate(pageEngine, parsed, { variables, emitter, refusalOf, clock });
  return Result.match(rendered, {
    onSuccess: () => chartsDrawnAndLaidOut(emitter.buffer.trim()),
    onFailure: (stopped) => `${stoppedWords} ${problemOf(stopped)}, on line ${stopped.line}.`,
  });
}
