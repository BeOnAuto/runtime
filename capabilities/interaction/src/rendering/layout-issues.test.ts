import { describe, expect, it } from 'vitest';

import { layoutIssues } from './layout-issues.ts';

const titleWords = 'A card starts with what it is about: give the Card a title of a few words';
const onePieceWords =
  'A card with one piece is a text: split it into the parts a reader looks for, as the guide\'s "Lay the card out" says';
const linkWords = 'A link in a text is easy to miss: move it to a LinkButton under Actions';
const factsWords = 'Short facts read best side by side: write them as Fields';
const longWords =
  'A long text hides its point: split it into a lead, Fields and a body, as the guide\'s "Lay the card out" says';
const boldWords = 'Only the question is bold: keep one bold Text and make the others plain';
const primaryWords =
  'One button stands out: keep primary on the link the reader most likely needs and leave the others plain';
const replyWords = 'A reader answers by replying: add a muted Text that says exactly what to reply';

type Elements = Readonly<Record<string, unknown>>;

function cardOf(elements: Elements, card: Readonly<Record<string, unknown>> = {}) {
  return {
    root: 'card',
    elements: {
      card: { type: 'Card', props: { title: 'Orders' }, children: Object.keys(elements), ...card },
      ...elements,
    },
  };
}

function textOf(content: unknown, style?: unknown) {
  return { type: 'Text', props: { content, ...(style === undefined ? {} : { style }) } };
}

function twoTexts(content: unknown) {
  return cardOf({ lead: textOf(content), other: textOf('Plain words') });
}

function detailsOf(card: unknown, takesAnswer = false): readonly string[] {
  return layoutIssues(card, takesAnswer).map(({ pointer, detail }) => `${pointer}: ${detail}`);
}

describe('the layout of a card whose root has no title or fewer than two pieces', () => {
  it('refuses a Card with no title, or a blank one, and accepts one written as an expression', () => {
    const elements = { a: textOf('One'), b: textOf('Two') };

    expect(detailsOf(cardOf(elements, { props: {} }))).toEqual(['/elements/card: ' + titleWords]);
    expect(detailsOf(cardOf(elements, { props: { title: '  ' } }))).toEqual(['/elements/card: ' + titleWords]);
    expect(detailsOf(cardOf(elements, { props: { title: { $state: '/input/title' } } }))).toEqual([]);
    expect(detailsOf(cardOf(elements, { props: undefined }))).toEqual(['/elements/card: ' + titleWords]);
  });

  it('refuses a Card with fewer than two children, written or missing', () => {
    expect(detailsOf(cardOf({ a: textOf('One') }))).toEqual(['/elements/card: ' + onePieceWords]);
    expect(detailsOf(cardOf({}, { children: undefined }))).toEqual(['/elements/card: ' + onePieceWords]);
    expect(detailsOf(cardOf({}, { children: 'a' }))).toEqual(['/elements/card: ' + onePieceWords]);
    expect(detailsOf(cardOf({ a: textOf('One'), b: textOf('Two') }))).toEqual([]);
  });

  it('looks only at a root that is a Card', () => {
    const card = { root: 'card', elements: { card: { type: 'Section', children: ['a'] }, a: textOf('One') } };

    expect(detailsOf(card)).toEqual([]);
  });

  it('finds nothing in what is not a card yet', () => {
    expect(detailsOf(null)).toEqual([]);
    expect(detailsOf({ root: 4, elements: {} })).toEqual([]);
    expect(detailsOf({ root: 'card', elements: [] })).toEqual([]);
    expect(detailsOf({ root: 'card', elements: {} })).toEqual([]);
    expect(detailsOf({ root: 'card', elements: { card: 'Card' } })).toEqual([]);
  });
});

describe('the layout of the text of a card', () => {
  it('refuses a web address, a Markdown link and a Slack link, and accepts text with none', () => {
    const issue = ['/elements/lead/props/content: ' + linkWords];

    expect(detailsOf(twoTexts('See https://example.com for more'))).toEqual(issue);
    expect(detailsOf(twoTexts('See http://example.com'))).toEqual(issue);
    expect(detailsOf(twoTexts('See [the report](/report)'))).toEqual(issue);
    expect(detailsOf(twoTexts('See <https://example.com|the report>'))).toEqual(issue);
    expect(detailsOf(twoTexts('See the report, or write [x] or <b> or a|b'))).toEqual([]);
  });

  it('refuses two or more lines of the form Label: value, with or without emphasis', () => {
    const issue = ['/elements/lead/props/content: ' + factsWords];

    expect(detailsOf(twoTexts('Owner: Ada\nDue: Friday'))).toEqual(issue);
    expect(detailsOf(twoTexts('*Owner*: Ada\n**Due**: Friday'))).toEqual(issue);
    expect(detailsOf(twoTexts('*Owner:* Ada\n**Due:** Friday\nNothing else'))).toEqual(issue);
    expect(detailsOf(twoTexts('Owner: Ada'))).toEqual([]);
    expect(detailsOf(twoTexts('Owner: Ada\nand then a sentence with no label'))).toEqual([]);
    expect(detailsOf(twoTexts('Owner:Ada\nDue:Friday'))).toEqual([]);
  });

  it('refuses a text of more than 600 characters, and accepts one of exactly 600', () => {
    expect(detailsOf(twoTexts('x'.repeat(601)))).toEqual(['/elements/lead/props/content: ' + longWords]);
    expect(detailsOf(twoTexts('x'.repeat(600)))).toEqual([]);
  });

  it('checks only the literal text of a template', () => {
    const longTemplate = { $template: `${'x'.repeat(590)} \${/input/a} \${/input/b}` };
    const linkTemplate = { $template: 'Open https://example.com/${/input/id}' };
    const readingTemplate = { $template: 'Hello ${/input/name}' };

    expect(detailsOf(twoTexts(longTemplate))).toEqual([]);
    expect(detailsOf(twoTexts({ $template: `${'x'.repeat(601)} \${/input/a}` }))).toEqual([
      '/elements/lead/props/content: ' + longWords,
    ]);
    expect(detailsOf(twoTexts(linkTemplate))).toEqual(['/elements/lead/props/content: ' + linkWords]);
    expect(detailsOf(twoTexts(readingTemplate))).toEqual([]);
  });
});

describe('the text of a card that is not known when it is saved', () => {
  it('skips a text that reads the run, is repeated, or sits inside what is repeated', () => {
    const link = 'https://example.com';
    const card = cardOf({
      reading: textOf({ $state: '/input/link' }),
      numbers: textOf({ $template: '${/input/one} ${/input/two}' }),
      list: { type: 'Section', repeat: { statePath: '/input/items' }, children: ['inner', 'list', 'nobody'] },
      inner: textOf(link, 'bold'),
      again: { ...textOf(link, 'bold'), repeat: { statePath: '/input/items' } },
      plain: { type: 'Section', children: ['nobody', 4] },
    });

    expect(detailsOf(card)).toEqual([]);
  });

  it('reads a text with no props as having no literal text', () => {
    const card = cardOf({ bare: { type: 'Text' }, other: textOf('Plain words') });

    expect(detailsOf(card)).toEqual([]);
  });
});

describe('the emphasis of a card', () => {
  it('refuses a second bold Text and each after it, and accepts one bold Text', () => {
    const bold = (content: string) => textOf(content, 'bold');

    expect(detailsOf(cardOf({ a: bold('One'), b: textOf('Two') }))).toEqual([]);
    expect(detailsOf(cardOf({ a: bold('One'), b: bold('Two'), c: bold('Three') }))).toEqual([
      '/elements/b/props/style: ' + boldWords,
      '/elements/c/props/style: ' + boldWords,
    ]);
  });
});

function linkButton(style?: unknown) {
  return {
    type: 'LinkButton',
    props: { label: 'Open', url: 'https://example.com', ...(style === undefined ? {} : { style }) },
  };
}

describe('the links of a card', () => {
  it('refuses a second primary link and each after it, and accepts one', () => {
    expect(detailsOf(cardOf({ a: linkButton('primary'), b: linkButton() }))).toEqual([]);
    expect(detailsOf(cardOf({ a: linkButton('primary'), b: linkButton('primary'), c: linkButton('primary') }))).toEqual(
      ['/elements/b/props/style: ' + primaryWords, '/elements/c/props/style: ' + primaryWords],
    );
  });

  it('counts only a literal primary on a LinkButton outside what is repeated', () => {
    const repeated = { ...linkButton('primary'), repeat: { statePath: '/input/links' } };
    const card = cardOf({
      a: linkButton('primary'),
      danger: linkButton('danger'),
      reading: linkButton({ $state: '/input/style' }),
      list: { type: 'Section', repeat: { statePath: '/input/items' }, children: ['inner'] },
      inner: linkButton('primary'),
      again: repeated,
      text: textOf('Plain words', 'primary'),
      bare: { type: 'LinkButton' },
    });

    expect(detailsOf(card)).toEqual([]);
  });
});

describe('the reply a card that takes an answer tells the reader', () => {
  it('refuses a card with no muted Text when the function takes an answer', () => {
    const card = cardOf({ a: textOf('Approve?', 'bold'), b: textOf('Plain words') });

    expect(detailsOf(card, true)).toEqual(['/elements/card: ' + replyWords]);
    expect(detailsOf(card, false)).toEqual([]);
  });

  it('accepts a muted Text, or a style it cannot know, or a muted Text that is repeated', () => {
    const asked = textOf('Approve?', 'bold');

    expect(detailsOf(cardOf({ a: asked, b: textOf('Reply yes or no', 'muted') }), true)).toEqual([]);
    expect(detailsOf(cardOf({ a: asked, b: textOf('Reply', { $state: '/input/style' }) }), true)).toEqual([]);
    const repeated = { ...textOf('Reply', 'muted'), repeat: { statePath: '/input/items' } };
    expect(detailsOf(cardOf({ a: asked, b: repeated }), true)).toEqual([]);
  });
});

describe('a card that passes every check', () => {
  it('has a title, two pieces, no link or list of labels in a text, one bold Text and a muted reply', () => {
    const card = cardOf({
      lead: textOf('Two orders are late.'),
      ask: textOf('Ship them today?', 'bold'),
      reply: textOf('Reply yes or no.', 'muted'),
    });

    expect(detailsOf(card, true)).toEqual([]);
  });
});
