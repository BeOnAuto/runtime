import { Result, type Schema } from 'effect';
import { toValue, type Emitter } from 'liquidjs';

import { outputText } from '../template/output-text.ts';
import type { TemplateEngine } from '../template/template-engine.ts';
import { parsedTemplate } from '../template/template-parsing.ts';
import { renderedTemplate, type RenderFailure } from '../template/template-rendering.ts';
import { standingRenderClock } from './time/stepping-clock.ts';

function noRefusal(): undefined {
  return undefined;
}

export function renderedText(
  engine: TemplateEngine,
  body: string,
  variables: Readonly<Record<string, Schema.Json>> = {},
): Result.Result<string, RenderFailure> {
  const parsed = Result.getOrThrow(parsedTemplate(engine, body, 1));
  let written = '';
  const emitter: Emitter = {
    buffer: '',
    write(html: unknown) {
      written += outputText(toValue(html));
    },
  };
  return Result.map(
    renderedTemplate<never>(engine, parsed, { variables, emitter, refusalOf: noRefusal, clock: standingRenderClock }),
    () => written,
  );
}
