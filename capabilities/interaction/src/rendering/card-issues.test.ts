import { describe, expect, it } from 'vitest';

import { cardIssues } from './card-issues.ts';

const anyWords: unknown = expect.any(String);

const welcome = {
  root: 'card',
  elements: {
    card: { type: 'Card', props: { title: 'Hello' }, children: ['body', 'rule', 'facts'] },
    body: { type: 'Text', props: { content: { $state: '/input/name' } } },
    rule: { type: 'Divider' },
    facts: { type: 'Fields', children: ['fact'] },
    fact: { type: 'Field', props: { label: 'Seats', value: 3 } },
  },
};

function withElements(elements: Readonly<Record<string, unknown>>, root = 'card') {
  return { root, elements };
}

describe('the check of the shape of a card for slack', () => {
  it('finds nothing in a card that reads the input and the moment', () => {
    expect(cardIssues('slack', welcome)).toEqual([]);
  });

  it('refuses a body that is not a mapping', () => {
    expect(cardIssues('slack', 'Hello')).toEqual([
      { pointer: '', detail: 'Write the body as a mapping with `root` and `elements`' },
    ]);
    expect(cardIssues('slack', ['a'])).toHaveLength(1);
    expect(cardIssues('slack', null)).toHaveLength(1);
  });

  it('refuses a root that is not text and elements that are not a mapping', () => {
    expect(cardIssues('slack', { root: 4, elements: [] })).toEqual([
      { pointer: '/root', detail: anyWords },
      {
        pointer: '/elements',
        detail: anyWords,
      },
    ]);
  });

  it('refuses a root that names no element', () => {
    expect(cardIssues('slack', withElements({ card: { type: 'Divider' } }, 'main'))).toEqual([
      { pointer: '/root', detail: 'Root names "main", which is not under `elements`; add it or name another element' },
    ]);
  });
});

describe('the check of the elements of a card for slack', () => {
  it('refuses an element that is not a mapping', () => {
    expect(cardIssues('slack', withElements({ card: 'Card' }))).toEqual([
      { pointer: '/elements/card', detail: anyWords },
    ]);
  });

  it('refuses a type outside the components and names the ones to write', () => {
    const [issue, ...rest] = cardIssues('slack', withElements({ card: { type: 'Chartt' } }));

    expect(rest).toEqual([]);
    expect(issue?.pointer).toBe('/elements/card/type');
    expect(issue?.detail).toBe(
      'Write `type` as one of: Card, Section, Text, Fields, Field, Table, Chart, Divider, Image, Actions, Button, LinkButton',
    );
    expect(cardIssues('slack', withElements({ card: {} }))).toHaveLength(1);
    expect(cardIssues('slack', withElements({ card: { type: 'toString' } }))).toHaveLength(1);
  });
});

function withLinkStyle(style: unknown) {
  return withElements({
    card: { type: 'Card', props: { title: 'T' }, children: ['link'] },
    link: { type: 'LinkButton', props: { label: 'Go', url: 'https://example.com', style } },
  });
}

describe('the style of a LinkButton', () => {
  const refusal = [
    { pointer: '/elements/link/props/style', detail: "A LinkButton's style is primary or danger, or left out" },
  ];

  it('is refused unless it is primary or danger', () => {
    expect(cardIssues('slack', withLinkStyle('green'))).toEqual(refusal);
    expect(cardIssues('slack', withLinkStyle('default'))).toEqual(refusal);
    expect(cardIssues('slack', withLinkStyle(null))).toEqual(refusal);
  });

  it('is accepted as primary, danger or an expression', () => {
    expect(cardIssues('slack', withLinkStyle('primary'))).toEqual([]);
    expect(cardIssues('slack', withLinkStyle('danger'))).toEqual([]);
    expect(cardIssues('slack', withLinkStyle({ $state: '/input/style' }))).toEqual([]);
  });

  it('is judged only on a LinkButton that writes one', () => {
    const card = withElements({
      card: { type: 'Card', props: { title: 'T' }, children: ['plain', 'bare', 'text'] },
      plain: { type: 'LinkButton', props: { label: 'Go', url: 'https://example.com' } },
      bare: { type: 'LinkButton' },
      text: { type: 'Text', props: { content: 'x', style: 'bold' } },
    });

    const pointers = cardIssues('slack', card).map(({ pointer }) => pointer);

    expect(pointers.filter((pointer) => pointer.endsWith('/style'))).toEqual([]);
  });
});

describe('the check of the interactive components of a card for slack', () => {
  it('refuses a Button where the function takes no answer, and points to a LinkButton', () => {
    const card = withElements({
      card: { type: 'Card', props: { title: 'Pick' }, children: ['actions'] },
      actions: { type: 'Actions', children: ['yes', 'guide'] },
      yes: { type: 'Button', props: { label: 'Yes', sets: [{ at: '/choice', value: 'yes' }] } },
      guide: { type: 'LinkButton', props: { label: 'Guide', url: 'https://example.com' } },
    });

    expect(cardIssues('slack', card)).toEqual([
      {
        pointer: '/elements/yes/type',
        detail: anyWords,
      },
    ]);
  });

  it('refuses a child that names no element', () => {
    const card = withElements({ card: { type: 'Card', props: { title: 'T' }, children: ['body', 7] } });

    expect(cardIssues('slack', card)).toEqual([
      {
        pointer: '/elements/card/children/0',
        detail: 'This child names no element; add an element with that id under `elements`, or remove it',
      },
      {
        pointer: '/elements/card/children/1',
        detail: 'This child names no element; add an element with that id under `elements`, or remove it',
      },
    ]);
  });

  it('refuses children that are not a list', () => {
    expect(
      cardIssues('slack', withElements({ card: { type: 'Card', props: { title: 'T' }, children: 'body' } })),
    ).toEqual([{ pointer: '/elements/card/children', detail: 'Write `children` as a list of element ids' }]);
  });
});

describe('the check of the props of a card for slack', () => {
  it('refuses $bindState and $bindItem wherever props write them', () => {
    const card = withElements({
      card: {
        type: 'Card',
        props: { title: { $bindState: '/input/title' }, subtitle: [{ $bindItem: 'name' }] },
      },
    });

    expect(cardIssues('slack', card).map(({ pointer }) => pointer)).toEqual([
      '/elements/card/props/title/$bindState',
      '/elements/card/props/subtitle/0/$bindItem',
    ]);
    expect(cardIssues('slack', card)[0]?.detail).toBe(
      '$bindState takes an answer from the reader, which this message cannot; write { $state: /input/<field> } to show a value',
    );
  });

  it('refuses a state key, for the run supplies the state', () => {
    expect(cardIssues('slack', { ...welcome, state: { input: {} } })).toEqual([
      {
        pointer: '/state',
        detail: anyWords,
      },
    ]);
  });
});

describe('the check of the props of an element for slack', () => {
  it('refuses props that are not a mapping', () => {
    expect(cardIssues('slack', withElements({ card: { type: 'Card', props: 'Hello' } }))).toEqual([
      { pointer: '/elements/card/props', detail: 'Write `props` as a mapping' },
    ]);
  });

  it('checks the props that write no expression against the component', () => {
    const card = withElements({
      card: { type: 'Card', props: { title: 'T' }, children: ['body', 'chart'] },
      body: { type: 'Text', props: { content: 4 } },
      chart: {
        type: 'Chart',
        props: { title: 'Users', chart: { type: 'line', categories: ['a'], series: [{ name: 'w', values: 'x' }] } },
      },
      rule: { type: 'Text' },
    });

    const issues = cardIssues('slack', card);

    expect(issues.map(({ pointer }) => pointer)).toEqual([
      '/elements/body/props/content',
      '/elements/chart/props/chart',
      '/elements/rule/props/content',
    ]);
    expect(issues[0]?.detail).toContain('This does not fit a Text: ');
  });

  it('leaves the props that write an expression or a repeat to the run', () => {
    const card = withElements({
      card: { type: 'Card', props: { title: 'T' }, children: ['body', 'table'] },
      body: { type: 'Text', props: { content: { $state: '/input/n' }, style: 'loud' } },
      table: { type: 'Table', repeat: { statePath: '/input/rows' }, props: { headers: 'x' } },
    });

    expect(cardIssues('slack', card)).toEqual([]);
  });
});

function buttonCard(props?: unknown, extra: Readonly<Record<string, unknown>> = {}) {
  return withElements({
    card: { type: 'Card', props: { title: 'Pick' }, children: ['actions'] },
    actions: { type: 'Actions', children: ['yes'] },
    yes: { type: 'Button', props },
    ...extra,
  });
}

const yes = { label: 'Yes', sets: [{ at: '/choice', value: 'yes' }] };

function detailsOf(props: unknown): readonly string[] {
  return cardIssues('slack', buttonCard(props), true).map(({ pointer }) => pointer);
}

describe('the check of a Button where the function takes an answer', () => {
  it('finds nothing in a Button that sets a place, with a style or an expression for a place and a value', () => {
    expect([
      detailsOf(yes),
      detailsOf({ ...yes, style: 'danger', once: true }),
      detailsOf({ ...yes, style: { $state: '/input/style' } }),
      detailsOf({
        label: { $state: '/input/label' },
        sets: [{ at: { $template: '/a/${id}' }, value: { $item: 'x' } }],
      }),
    ]).toEqual([[], [], [], []]);
  });

  it('is judged on a Button alone', () => {
    expect(cardIssues('slack', buttonCard({ label: 'Go' }, { yes: { type: 'Divider' } }), true)).toEqual([]);
  });
});

describe('the check of the sets of a Button where the function takes an answer', () => {
  it('is refused for sets that are none, empty, or not a mapping', () => {
    expect([
      detailsOf({ label: 'Yes' }),
      detailsOf({ label: 'Yes', sets: [] }),
      detailsOf({ label: 'Yes', sets: 'yes' }),
      detailsOf({ label: 'Yes', sets: ['yes'] }),
    ]).toEqual([
      ['/elements/yes/props/sets'],
      ['/elements/yes/props/sets'],
      ['/elements/yes/props/sets'],
      ['/elements/yes/props/sets/0'],
    ]);
  });

  it('is refused for a place that is no pointer, a missing value, and no label', () => {
    expect([
      detailsOf({ label: 'Yes', sets: [{ at: 'choice', value: 'yes' }] }),
      detailsOf({ label: 'Yes', sets: [{ at: '/choice' }] }),
      detailsOf({ sets: yes.sets }),
      detailsOf({ label: '', sets: yes.sets }),
    ]).toEqual([
      ['/elements/yes/props/sets/0/at'],
      ['/elements/yes/props/sets/0'],
      ['/elements/yes/props/label'],
      ['/elements/yes/props/label'],
    ]);
  });

  it('is refused for a style that is neither primary nor danger, and for an id or a value of its own', () => {
    expect([detailsOf({ ...yes, style: 'default' }), detailsOf({ ...yes, id: 'yes', value: 'x' })]).toEqual([
      ['/elements/yes/props/style'],
      ['/elements/yes/props/id', '/elements/yes/props/value'],
    ]);
  });

  it('is judged with no props as having none', () => {
    expect(cardIssues('slack', buttonCard(), true).map(({ pointer }) => pointer)).toEqual([
      '/elements/yes/props/label',
      '/elements/yes/props/sets',
    ]);
  });
});
