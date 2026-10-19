import { Result, type Schema } from 'effect';
import { toValue, type Emitter } from 'liquidjs';
import { describe, expect, it } from 'vitest';

import {
  outputText,
  parsedTemplate,
  renderedTemplate,
  templateEngine,
  type RenderFailure,
  type TemplateEngine,
} from '../template.ts';
import { standingRenderClock } from '../testing/time/stepping-clock.ts';

function noRefusal(): undefined {
  return undefined;
}

function argumentsChecked(this: { readonly token: { readonly args: string } }): void {
  if (this.token.args.trim() !== '') {
    throw new Error('{% stamp %} takes no arguments');
  }
}

function textEmitter(): Emitter & { readonly text: () => string } {
  let written = '';
  return {
    buffer: '',
    write(html: unknown) {
      written += outputText(toValue(html));
    },
    text: () => written,
  };
}

function rendering(
  engine: TemplateEngine,
  body: string,
  variables: Readonly<Record<string, Schema.Json>> = {},
): Result.Result<string, RenderFailure | undefined> {
  const parsed = Result.getOrThrow(parsedTemplate(engine, body, 1));
  const emitter = textEmitter();
  return Result.map(
    renderedTemplate(engine, parsed, { variables, emitter, refusalOf: noRefusal, clock: standingRenderClock }),
    () => emitter.text(),
  );
}

describe('an engine of a capability', () => {
  it('keeps the filters and tags every engine has, and leaves out those that load or capture templates', () => {
    const engine = templateEngine();

    expect(rendering(engine, '{{ "a-b" | upcase }} {% assign n = 2 %}{{ n | plus: 1 }}')).toEqual(
      Result.succeed('A-B 3'),
    );
    expect(parsedTemplate(engine, '{{ "a" | date: "%Y" }}', 1)).toEqual(
      Result.fail([{ line: 1, detail: 'undefined filter: date' }]),
    );
    expect(Result.isFailure(parsedTemplate(engine, '{% include "other" %}', 1))).toBe(true);
    expect(Result.isFailure(parsedTemplate(engine, '{% capture x %}y{% endcapture %}', 1))).toBe(true);
  });

  it('takes the filters and tags it is given, and no other engine sees them', () => {
    const shouting = templateEngine(() => ({
      filters: { shout: (value: unknown) => `${outputText(value)}!` },
      tags: { stamp: { parse: argumentsChecked, render: () => 'STAMP' } },
    }));

    expect(rendering(shouting, '{{ "hi" | shout }} {% stamp %}')).toEqual(Result.succeed('hi! STAMP'));
    expect(Result.isFailure(parsedTemplate(templateEngine(), '{{ "hi" | shout }}', 1))).toBe(true);
  });
});
