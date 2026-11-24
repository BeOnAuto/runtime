import { cardHoldsAButton } from './button-issues.ts';
import type { CardIssue } from './card-issues.ts';
import { pointerTo } from './json-pointers.ts';
import { entriesOf, hasKey, isList, isRecord } from './written-values.ts';

type Written = Readonly<Record<string, unknown>>;

interface TextElement {
  readonly pointer: string;
  readonly props: Written;
  readonly repeated: boolean;
}

const longestText = 600;
const templateReference = /\$\{[^}]*\}/gu;
const linkInText = /https?:\/\/|\[[^\]]+\]\([^)]+\)|<[^<>|]+\|[^<>]+>/u;
const labelledLine = /^[ \t]*\*{0,2}[^:*\n]{1,40}\*{0,2}:\*{0,2}[ \t]+\S/gmu;

const titleWords = 'A card starts with what it is about: give the Card a title of a few words';
const onePieceWords =
  'A card with one piece is a text: split it into the parts a reader looks for, as the guide\'s "Lay the card out" says';
const linkWords = 'A link in a text is easy to miss: move it to a LinkButton under Actions';
const factsWords = 'Short facts read best side by side: write them as Fields';
const longWords =
  'A long text hides its point: split it into a lead, Fields and a body, as the guide\'s "Lay the card out" says';
const boldWords = 'Only the question is bold: keep one bold Text and make the others plain';
const primaryWords =
  'One button of a row stands out: keep primary on the button the reader most likely needs and leave the others plain';
const replyWords = 'A reader answers by replying: add a muted Text that says exactly what to reply';

function propsOf(element: Written): Written {
  const props = element['props'];
  return isRecord(props) ? props : {};
}

function childIdsOf(element: Written): readonly string[] {
  const children = element['children'];
  return isList(children) ? children.filter((child): child is string => typeof child === 'string') : [];
}

function repeatedIdsOf(elements: Written): ReadonlySet<string> {
  const reached = new Set<string>();
  const reach = (id: string): void => {
    const element = hasKey(elements, id) ? elements[id] : undefined;
    if (reached.has(id) || !isRecord(element)) {
      return;
    }
    reached.add(id);
    childIdsOf(element).forEach((child) => {
      reach(child);
    });
  };
  for (const [id, element] of entriesOf(elements)) {
    if (isRecord(element) && hasKey(element, 'repeat')) {
      reach(id);
    }
  }
  return reached;
}

function isStyledPrimary(element: unknown): element is Written {
  const type = isRecord(element) ? element['type'] : undefined;
  return isRecord(element) && (type === 'LinkButton' || type === 'Button') && propsOf(element)['style'] === 'primary';
}

function primaryPointersOfGroup(elements: Written, group: Written): readonly string[] {
  return childIdsOf(group).flatMap((id) => {
    const child = hasKey(elements, id) ? elements[id] : undefined;
    return isStyledPrimary(child) && !hasKey(child, 'repeat')
      ? [pointerTo(pointerTo(pointerTo('/elements', id), 'props'), 'style')]
      : [];
  });
}

function primaryIssues(elements: Written): readonly CardIssue[] {
  return Object.values(elements)
    .filter((element): element is Written => isRecord(element) && element['type'] === 'Actions')
    .flatMap((group) => primaryPointersOfGroup(elements, group).slice(1))
    .map((pointer) => ({ pointer, detail: primaryWords }));
}

function textsOf(elements: Written): readonly TextElement[] {
  const repeated = repeatedIdsOf(elements);
  return entriesOf(elements).flatMap(([id, element]) =>
    isRecord(element) && element['type'] === 'Text'
      ? [{ pointer: pointerTo('/elements', id), props: propsOf(element), repeated: repeated.has(id) }]
      : [],
  );
}

function literalTextOf(content: unknown): string | undefined {
  if (typeof content === 'string') {
    return content;
  }
  const template = isRecord(content) ? content['$template'] : undefined;
  return typeof template === 'string' ? template.replaceAll(templateReference, '') : undefined;
}

function contentIssues({ pointer, props, repeated }: TextElement): readonly CardIssue[] {
  const text = repeated ? undefined : literalTextOf(props['content']);
  if (text === undefined) {
    return [];
  }
  const at = pointerTo(pointerTo(pointer, 'props'), 'content');
  return [
    ...(linkInText.test(text) ? [{ pointer: at, detail: linkWords }] : []),
    ...([...text.matchAll(labelledLine)].length >= 2 ? [{ pointer: at, detail: factsWords }] : []),
    ...(text.length > longestText ? [{ pointer: at, detail: longWords }] : []),
  ];
}

function boldIssues(texts: readonly TextElement[]): readonly CardIssue[] {
  const bold = texts.filter(({ props, repeated }) => !repeated && props['style'] === 'bold');
  return bold.slice(1).map(({ pointer }) => ({
    pointer: pointerTo(pointerTo(pointer, 'props'), 'style'),
    detail: boldWords,
  }));
}

function mayBeMuted({ props }: TextElement): boolean {
  return props['style'] === 'muted' || isRecord(props['style']);
}

function replyIssues(texts: readonly TextElement[], card: unknown, rootPointer: string): readonly CardIssue[] {
  return texts.some((text) => mayBeMuted(text)) || cardHoldsAButton(card)
    ? []
    : [{ pointer: rootPointer, detail: replyWords }];
}

function rootIssues(element: Written, pointer: string): readonly CardIssue[] {
  const title = propsOf(element)['title'];
  const untitled = title === undefined || (typeof title === 'string' && title.trim() === '');
  return [
    ...(untitled ? [{ pointer, detail: titleWords }] : []),
    ...(childIdsOf(element).length < 2 ? [{ pointer, detail: onePieceWords }] : []),
  ];
}

export function layoutIssues(card: unknown, takesAnswer: boolean): readonly CardIssue[] {
  const root = isRecord(card) ? card['root'] : undefined;
  const elements = isRecord(card) ? card['elements'] : undefined;
  if (typeof root !== 'string' || !isRecord(elements) || !hasKey(elements, root)) {
    return [];
  }
  const rootElement = elements[root];
  const rootPointer = pointerTo('/elements', root);
  const texts = textsOf(elements);
  return [
    ...(isRecord(rootElement) && rootElement['type'] === 'Card' ? rootIssues(rootElement, rootPointer) : []),
    ...texts.flatMap((text) => contentIssues(text)),
    ...boldIssues(texts),
    ...primaryIssues(elements),
    ...(takesAnswer ? replyIssues(texts, card, rootPointer) : []),
  ];
}
