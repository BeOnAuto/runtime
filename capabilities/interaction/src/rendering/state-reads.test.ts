import { describe, expect, it } from 'vitest';

import { stateReadsOf } from './state-reads.ts';

const stateCard = {
  root: 'card',
  elements: {
    card: { type: 'Card', props: { title: { $state: '/input/title' } }, children: ['a/b'] },
    'a/b': {
      type: 'Text',
      props: { content: { $cond: { $state: '/input/flag' }, $then: 'yes', $else: { $state: '/today' } } },
      visible: { $state: '/input/shown' },
    },
  },
};

const templateCard = {
  root: 'card',
  elements: {
    card: { type: 'Card', props: { title: { $template: 'Hi ${/input/name}, it is ${/now} and ${bare}' } } },
  },
};

const repeatCard = {
  root: 'card',
  elements: {
    card: { type: 'Card', repeat: { statePath: '/input/items' }, props: { rows: [[{ $item: 'name' }]] } },
    inner: { type: 'Section', repeat: { statePath: { $item: 'children' } } },
  },
};

const ignoredCard = {
  root: 'card',
  elements: {
    card: {
      type: 'Card',
      props: { title: { $state: 3 }, subtitle: { $index: true }, list: ['x', { $item: 'y' }] },
    },
    broken: 'not an element',
  },
};

describe('the state a card reads', () => {
  it('is every $state value, with the pointer of where it was written', () => {
    expect(stateReadsOf(stateCard)).toEqual([
      { pointer: '/elements/card/props/title/$state', path: '/input/title' },
      { pointer: '/elements/a~1b/props/content/$cond/$state', path: '/input/flag' },
      { pointer: '/elements/a~1b/props/content/$else/$state', path: '/today' },
      { pointer: '/elements/a~1b/visible/$state', path: '/input/shown' },
    ]);
  });

  it('is every absolute path inside a $template string', () => {
    expect(stateReadsOf(templateCard)).toEqual([
      { pointer: '/elements/card/props/title/$template', path: '/input/name' },
      { pointer: '/elements/card/props/title/$template', path: '/now' },
    ]);
  });

  it('is the state path a repeat walks, when it is written absolute', () => {
    expect(stateReadsOf(repeatCard)).toEqual([{ pointer: '/elements/card/repeat/statePath', path: '/input/items' }]);
  });

  it('ignores a $state that is not text, other expressions and plain values', () => {
    expect(stateReadsOf(ignoredCard)).toEqual([]);
  });

  it('is nothing for a value that is not a card', () => {
    expect(stateReadsOf('text')).toEqual([]);
    expect(stateReadsOf({ root: 'card' })).toEqual([]);
    expect(stateReadsOf({ elements: [] })).toEqual([]);
  });
});
