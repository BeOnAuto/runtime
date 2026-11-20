import { describe, expect, it } from 'vitest';

import { styledLinkMarker, withStyledLinksAsButtons } from './styled-links.ts';
import { isRecord } from './written-values.ts';

function cardWith(link: unknown) {
  return {
    root: 'card',
    elements: {
      card: { type: 'Card', props: { title: 'T' }, children: ['actions'] },
      actions: { type: 'Actions', props: {}, children: ['link'] },
      link,
    },
  };
}

function linkOf(rewritten: unknown): unknown {
  const elements = isRecord(rewritten) ? rewritten['elements'] : undefined;
  return isRecord(elements) ? elements['link'] : undefined;
}

describe('a LinkButton written with a style that colours', () => {
  it.each(['primary', 'danger'])('becomes a Button marked as a link, with %s as its style', (style) => {
    const written = cardWith({ type: 'LinkButton', props: { label: 'Open', url: 'https://example.com', style } });

    expect(linkOf(withStyledLinksAsButtons(written))).toEqual({
      type: 'Button',
      props: { id: `${styledLinkMarker}link`, label: 'Open', style, value: 'https://example.com' },
    });
  });

  it('passes a label and a url that read the run through untouched', () => {
    const label = { $template: 'Open ${/input/name}' };
    const url = { $state: '/input/url' };
    const written = cardWith({ type: 'LinkButton', props: { label, url, style: 'primary' } });

    expect(linkOf(withStyledLinksAsButtons(written))).toMatchObject({
      props: { id: 'auto-link:link', label, style: 'primary', value: url },
    });
  });

  it('keeps its repeat, its children and every other key as written', () => {
    const repeat = { statePath: '/input/links' };
    const props = { label: { $item: 'label' }, url: { $item: 'url' }, style: 'danger' };
    const written = cardWith({ type: 'LinkButton', props, repeat, children: [], visible: true });

    expect(linkOf(withStyledLinksAsButtons(written))).toMatchObject({
      type: 'Button',
      repeat,
      children: [],
      visible: true,
    });
  });

  it('leaves the rest of the card as written', () => {
    const props = { label: 'Open', url: 'https://example.com', style: 'primary' };
    const written = cardWith({ type: 'LinkButton', props });

    expect(withStyledLinksAsButtons(written)).toMatchObject({
      root: 'card',
      elements: { card: written.elements.card, actions: written.elements.actions },
    });
  });
});

describe('an element that is not a styled LinkButton', () => {
  it.each([
    ['a LinkButton with no style', { type: 'LinkButton', props: { label: 'Open', url: 'https://example.com' } }],
    ['a style that is an expression', { type: 'LinkButton', props: { label: 'A', url: 'u', style: { $state: '/x' } } }],
    ['a style that does not colour', { type: 'LinkButton', props: { label: 'A', url: 'u', style: 'default' } }],
    ['a LinkButton with no props', { type: 'LinkButton' }],
    ['another type with a style', { type: 'Text', props: { content: 'x', style: 'primary' } }],
    ['a Button', { type: 'Button', props: { id: 'yes', label: 'Yes', style: 'primary' } }],
    ['no element', 'LinkButton'],
  ])('is left alone: %s', (_what: string, element: unknown) => {
    const written = cardWith(element);

    expect(withStyledLinksAsButtons(written)).toEqual(written);
  });

  it('is left alone when the body is no card', () => {
    expect(withStyledLinksAsButtons('text')).toBe('text');
    expect(withStyledLinksAsButtons({ root: 'card' })).toEqual({ root: 'card' });
  });
});
