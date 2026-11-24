import type { CardIssue } from './card-issues.ts';
import { pointerTo } from './json-pointers.ts';
import { hasKey, isList, isRecord, itemsOf } from './written-values.ts';

type Written = Readonly<Record<string, unknown>>;

const setsWords =
  'A Button sets part of the answer: write `sets` as a list of { at, value }, each `at` a place in the answer such as /choice and each `value` what the click puts there';
const placeWords = 'Write `at` as a place in the answer that starts with a slash, such as /choice, or as an expression';
const valueWords = 'Write `value` as what the click puts at that place';
const labelWords = 'Write `label` as the words on the button';
const styleWords = "A Button's style is primary or danger, or left out";
const namedByTheRuntimeWords =
  'Remove it: the runtime names each button and keeps what it sets, so a click names no value';

const styles = new Set<unknown>(['primary', 'danger']);

function setIssues(pointer: string, set: unknown): readonly CardIssue[] {
  if (!isRecord(set)) {
    return [{ pointer, detail: setsWords }];
  }
  const { at } = set;
  const placed = isRecord(at) || (typeof at === 'string' && at.startsWith('/'));
  return [
    ...(placed ? [] : [{ pointer: pointerTo(pointer, 'at'), detail: placeWords }]),
    ...(hasKey(set, 'value') ? [] : [{ pointer, detail: valueWords }]),
  ];
}

function setsIssues(propsPointer: string, sets: unknown): readonly CardIssue[] {
  const pointer = pointerTo(propsPointer, 'sets');
  if (!isList(sets) || sets.length === 0) {
    return [{ pointer, detail: setsWords }];
  }
  return itemsOf(sets).flatMap(([index, set]) => setIssues(pointerTo(pointer, index), set));
}

function styleIssues(propsPointer: string, props: Written): readonly CardIssue[] {
  const { style } = props;
  const fits = !hasKey(props, 'style') || styles.has(style) || isRecord(style);
  return fits ? [] : [{ pointer: pointerTo(propsPointer, 'style'), detail: styleWords }];
}

function labelIssues(propsPointer: string, props: Written): readonly CardIssue[] {
  const { label } = props;
  const written = (typeof label === 'string' && label !== '') || isRecord(label);
  return written ? [] : [{ pointer: pointerTo(propsPointer, 'label'), detail: labelWords }];
}

function namedIssues(propsPointer: string, props: Written): readonly CardIssue[] {
  return ['id', 'value']
    .filter((name) => hasKey(props, name))
    .map((name) => ({ pointer: pointerTo(propsPointer, name), detail: namedByTheRuntimeWords }));
}

export function buttonIssues(element: Written, pointer: string): readonly CardIssue[] {
  if (element['type'] !== 'Button') {
    return [];
  }
  const propsPointer = pointerTo(pointer, 'props');
  const props = isRecord(element['props']) ? element['props'] : {};
  return [
    ...labelIssues(propsPointer, props),
    ...setsIssues(propsPointer, props['sets']),
    ...styleIssues(propsPointer, props),
    ...namedIssues(propsPointer, props),
  ];
}

export function cardHoldsAButton(card: unknown): boolean {
  const elements = isRecord(card) ? card['elements'] : undefined;
  return (
    isRecord(elements) && Object.values(elements).some((element) => isRecord(element) && element['type'] === 'Button')
  );
}
