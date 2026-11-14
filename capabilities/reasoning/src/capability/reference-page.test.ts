import { readFileSync } from 'node:fs';

import { templateLimits } from '@on.auto/definitions/template';
import { toolBounds } from '@on.auto/tool-servers';
import { describe, expect, it } from 'vitest';

import { mostOutputTokens, mostToolCalls } from '../definition/definition-settings.ts';
import { defaultMostInputTokens, inputTokensRange, inputTokensSetting } from '../settings/input-token-settings.ts';

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
    expect(page).toContain(`It makes at most ${toolBounds.actingCallsInRun} calls of tools not marked \`reads\``);
    expect(rowOf('`max_tool_calls`')).toContain(
      `from 1 to ${counted.format(mostToolCalls)}: a count of all a run's tool calls, in place of ${toolBounds.actingCallsInRun} calls of tools not marked \`reads\``,
    );
    expect(page).toContain(`sends more than ${toolBounds.argumentBytes / 1024} KiB of arguments`);
  });

  it('give the input tokens a run may read, and the setting of a runtime of one’s own, as the code holds them', () => {
    expect(rowOf('`max_input_tokens`')).toContain(
      `A whole number from ${counted.format(inputTokensRange.least)} to ${counted.format(inputTokensRange.most)}: the input tokens a run may read;`,
    );
    expect(page).toContain(`\`${inputTokensSetting}\` is both, ${counted.format(defaultMostInputTokens)} unless set`);
  });
});
