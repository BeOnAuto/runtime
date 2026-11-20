import { entriesOf, isRecord } from './written-values.ts';

type Written = Readonly<Record<string, unknown>>;

export const styledLinkMarker = 'auto-link:';

const colouringStyles = new Set<unknown>(['primary', 'danger']);

function propsOf(element: Written): Written {
  const props = element['props'];
  return isRecord(props) ? props : {};
}

function isStyledLink(element: unknown): element is Written {
  return isRecord(element) && element['type'] === 'LinkButton' && colouringStyles.has(propsOf(element)['style']);
}

function buttonOf(id: string, element: Written): Written {
  const { label, url, style } = propsOf(element);
  return { ...element, type: 'Button', props: { id: `${styledLinkMarker}${id}`, label, style, value: url } };
}

export function withStyledLinksAsButtons(card: unknown): unknown {
  const elements = isRecord(card) ? card['elements'] : undefined;
  if (!isRecord(card) || !isRecord(elements)) {
    return card;
  }
  const rewritten = entriesOf(elements).map(([id, element]): [string, unknown] => [
    id,
    isStyledLink(element) ? buttonOf(id, element) : element,
  ]);
  return { ...card, elements: Object.fromEntries(rewritten) };
}
