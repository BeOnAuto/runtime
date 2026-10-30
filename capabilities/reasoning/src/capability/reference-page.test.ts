import { readFileSync } from 'node:fs';

import { templateLimits } from '@on.auto/definitions/template';
import { toolBounds } from '@on.auto/tool-servers';
import { describe, expect, it } from 'vitest';

import { mostOutputTokens } from '../definition/definition-settings.ts';
import { defaultMostInputTokens } from './definition-request.ts';

const page = readFileSync(new URL('../../../../docs/reference/reasoning-format.md', import.meta.url), 'utf8');

const counted = new Intl.NumberFormat('en');

function rowOf(label: string): string {
  return String(page.split('\n').find((line) => line.startsWith(`| ${label}`)));
}

describe('the bounds on the public reference page of reasoning functions', () => {
  it('give the most output tokens the code allows', () => {
    expect(rowOf('`config.max_output_tokens`')).toContain(`from 1 to ${counted.format(mostOutputTokens)}`);
  });

  it('give the limits of a template the code holds it to', () => {
    expect([
      rowOf('Length of the template'),
      rowOf('Names in tags and outputs'),
      rowOf('Time to render'),
      rowOf('Memory that filters and ranges may charge'),
      rowOf('Rendered instructions, and rendered message'),
    ]).toEqual([
      expect.stringContaining(`${counted.format(templateLimits.characters)} characters`),
      expect.stringContaining(counted.format(templateLimits.names)),
      expect.stringContaining(`${templateLimits.renderMilliseconds} ms`),
      expect.stringContaining(`${counted.format(templateLimits.memory)} characters or items`),
      expect.stringContaining(`${counted.format(templateLimits.renderedCharacters)} characters each`),
    ]);
  });

  it('give the bounds of the tool calls of a run the code holds it to', () => {
    expect(page).toContain(`A run makes at most ${toolBounds.callsInRun} calls;`);
    expect(page).toContain(
      `at most the input tokens the operator sets with \`REASONING_MAX_INPUT_TOKENS\`, ${counted.format(defaultMostInputTokens)} by default`,
    );
    expect(page).toContain(`sends more than ${toolBounds.argumentBytes / 1024} KiB of arguments`);
  });
});
