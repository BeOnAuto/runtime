import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { inputVariableIssues, parsedTemplate, templateEngine } from '../template.ts';

const engine = templateEngine();

function issuesOf(body: string, schema?: Schema.JsonObject) {
  const { variables } = Result.getOrThrow(parsedTemplate(engine, body, 1));
  return inputVariableIssues(variables, schema, 'an interaction function’s message');
}

describe('the variables a template of a capability reads', () => {
  it('are input, today and now, and what it assigns', () => {
    expect(issuesOf('{% assign who = input.who %}{{ who }} {{ today }} {{ now }} {{ input.any.depth }}')).toEqual([]);
  });

  it('are nothing else, each named once on its line, in the words of the capability', () => {
    expect(issuesOf('{{ user }} {{ user.name }}\n{{ today.year }}')).toEqual([
      {
        line: 1,
        pointer: '',
        detail:
          'user is not a variable of an interaction function’s message, which reads input, today and now; assign it first',
      },
      { line: 2, pointer: '', detail: 'today is the date, as YYYY-MM-DD, and has no properties' },
    ]);
  });

  it('read only the properties of an input schema that allows no others', () => {
    const closed = { type: 'object', properties: { owner: { type: 'string' } }, additionalProperties: false };

    expect(issuesOf('{{ input.owner }} {{ input.ower }}', closed)).toEqual([
      { line: 1, pointer: '', detail: 'input.ower is not a property of the input schema, which allows no others' },
    ]);
    expect(issuesOf('{{ input.ower }}', { type: 'object', additionalProperties: false })).toHaveLength(1);
    expect(issuesOf('{{ input.ower }}', { type: 'object' })).toEqual([]);
  });
});
