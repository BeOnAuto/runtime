import { describe, expect, it } from 'vitest';

import { markdownOf, paragraph, templateLead } from '../index.ts';
import { inBrackets, quoteLead } from './template-words.ts';

describe('the lead of a template read as a person reads it', () => {
  it('says that the names in bold stand for the values of each run, or of each build', () => {
    expect([templateLead('Its message', 'run'), templateLead('Its trainer reads the brief first', 'build')]).toEqual([
      paragraph('Its message, with the values of each run in place of the names in bold:'),
      paragraph('Its trainer reads the brief first, with the values of each build in place of the names in bold:'),
    ]);
  });
});

describe('the lead of a quote', () => {
  it("says, after the words that lead to it, that the words in brackets stand for the run's values, or the build's", () => {
    expect([
      quoteLead('run', 'It sends the approver this message through ', { server: 'gas' }),
      quoteLead('build', 'Its trainer reads this brief'),
    ]).toEqual([
      paragraph(
        'It sends the approver this message through ',
        { server: 'gas' },
        ", with the run's values in place of the words in brackets:",
      ),
      paragraph('Its trainer reads this brief', ", with the build's values in place of the words in brackets:"),
    ]);
  });

  it('writes a value of a run in brackets that Markdown keeps as they are, never as a link', () => {
    expect(
      markdownOf({
        title: 'quote',
        opening: [],
        body: [{ kind: 'quote', lines: [['For *', inBrackets('the month'), '*: ', inBrackets('the draft'), '(x)']] }],
        sections: [],
        appendix: [],
      })
        .split('\n\n')
        .at(-1),
    ).toBe('> For *\\[the month\\]*: \\[the draft\\](x)\n');
  });
});
