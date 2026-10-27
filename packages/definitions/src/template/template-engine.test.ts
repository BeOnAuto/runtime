import { Result } from 'effect';
import { filters } from 'liquidjs';
import { describe, expect, it } from 'vitest';

import { outputText, parsedTemplate, templateEngine, type TemplateIssue } from '../template.ts';
import { renderedText } from '../testing/rendered-text.ts';

function argumentsChecked(this: { readonly token: { readonly args: string } }): void {
  if (this.token.args.trim() !== '') {
    throw new Error('{% stamp %} takes no arguments');
  }
}

const keptFilters = [
  'abs',
  'append',
  'array_to_sentence_string',
  'at_least',
  'at_most',
  'base64_decode',
  'base64_encode',
  'capitalize',
  'ceil',
  'compact',
  'concat',
  'default',
  'divided_by',
  'downcase',
  'escape',
  'escape_once',
  'find',
  'find_index',
  'first',
  'floor',
  'group_by',
  'has',
  'join',
  'json',
  'last',
  'lstrip',
  'map',
  'minus',
  'modulo',
  'newline_to_br',
  'normalize_whitespace',
  'number_of_words',
  'plus',
  'pop',
  'prepend',
  'push',
  'raw',
  'reject',
  'remove',
  'remove_first',
  'remove_last',
  'replace',
  'replace_first',
  'replace_last',
  'reverse',
  'round',
  'rstrip',
  'shift',
  'size',
  'slice',
  'slugify',
  'sort',
  'sort_natural',
  'split',
  'squish',
  'strip',
  'strip_newlines',
  'sum',
  'times',
  'to_integer',
  'truncate',
  'truncatewords',
  'uniq',
  'unshift',
  'upcase',
  'where',
  'xml_escape',
];

const droppedFilters = [
  'where_exp',
  'reject_exp',
  'group_by_exp',
  'has_exp',
  'find_exp',
  'find_index_exp',
  'date',
  'date_to_xmlschema',
  'date_to_rfc822',
  'date_to_string',
  'date_to_long_string',
  'sample',
  'sha256',
  'hmac_sha256',
  'strip_html',
  'url_encode',
  'url_decode',
  'cgi_escape',
  'uri_escape',
  'inspect',
  'jsonify',
];

function issuesOf(body: string): readonly TemplateIssue[] {
  return Result.match(parsedTemplate(templateEngine(), body, 1), {
    onSuccess: ({ issues }) => issues,
    onFailure: (issues) => issues,
  });
}

describe('an engine of a capability', () => {
  it('keeps the filters and tags every engine has, and leaves out those that load or capture templates', () => {
    const engine = templateEngine();

    expect(renderedText(engine, '{{ "a-b" | upcase }} {% assign n = 2 %}{{ n | plus: 1 }}')).toEqual(
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

    expect(renderedText(shouting, '{{ "hi" | shout }} {% stamp %}')).toEqual(Result.succeed('hi! STAMP'));
    expect(Result.isFailure(parsedTemplate(templateEngine(), '{{ "hi" | shout }}', 1))).toBe(true);
  });
});

describe('the filters of every engine', () => {
  it.each([...keptFilters, 'money', 'clip', 'words'])('include %s', (filter) => {
    expect(issuesOf(`{{ input.a | ${filter} }}`)).toEqual([]);
  });

  it.each(droppedFilters)('leave out %s', (filter) => {
    expect(issuesOf(`{{ input.a | ${filter} }}`)).toEqual([{ line: 1, detail: `undefined filter: ${filter}` }]);
  });

  it('are every filter of Liquid, kept or left out', () => {
    expect(new Set([...keptFilters, ...droppedFilters])).toEqual(new Set(Object.keys(filters)));
  });
});
