import { expressionsIn } from './expressions.ts';
import { pointerTo } from './json-pointers.ts';
import { renderTargetOf, type RenderTargetName } from './render-targets.ts';
import { entriesOf, hasKey, isList, isRecord } from './written-values.ts';

export interface CardIssue {
  readonly pointer: string;
  readonly detail: string;
}

type Written = Readonly<Record<string, unknown>>;
type Target = ReturnType<typeof renderTargetOf>;

const bindingKeys = new Set(['$bindState', '$bindItem']);

function topLevelIssues(card: Written): readonly CardIssue[] {
  const { root, elements } = card;
  const issues: CardIssue[] = [];
  if (typeof root !== 'string') {
    issues.push({ pointer: '/root', detail: 'Write `root` as the id of the element that starts the message' });
  } else if (isRecord(elements) && !hasKey(elements, root)) {
    issues.push({
      pointer: '/root',
      detail: `Root names "${root}", which is not under \`elements\`; add it or name another element`,
    });
  }
  if (!isRecord(elements)) {
    issues.push({
      pointer: '/elements',
      detail: 'Write `elements` as a mapping from an element id to its `type`, `props` and `children`',
    });
  }
  if (hasKey(card, 'state')) {
    issues.push({
      pointer: '/state',
      detail:
        'Remove `state`: the run supplies it, so read the input with { $state: /input/<field> } and the moment with /today or /now',
    });
  }
  return issues;
}

function typeIssues(target: Target, pointer: string, type: unknown): readonly CardIssue[] {
  const at = pointerTo(pointer, 'type');
  const remedy = typeof type === 'string' && hasKey(target.interactive, type) ? target.interactive[type] : undefined;
  if (remedy !== undefined) {
    return [{ pointer: at, detail: `${String(type)} is interactive. ${remedy}` }];
  }
  if (typeof type === 'string' && hasKey(target.components, type)) {
    return [];
  }
  const allowed = Object.keys(target.components).join(', ');
  return [{ pointer: at, detail: `Write \`type\` as one of: ${allowed}` }];
}

function childIssues(elements: Written, pointer: string, children: unknown): readonly CardIssue[] {
  if (children === undefined) {
    return [];
  }
  if (!isList(children)) {
    return [{ pointer: pointerTo(pointer, 'children'), detail: 'Write `children` as a list of element ids' }];
  }
  return children.flatMap((child, index) =>
    typeof child === 'string' && hasKey(elements, child)
      ? []
      : [
          {
            pointer: pointerTo(pointerTo(pointer, 'children'), index),
            detail: `This child names no element; add an element with that id under \`elements\`, or remove it`,
          },
        ],
  );
}

function bindingIssues(propsPointer: string, props: unknown): readonly CardIssue[] {
  return expressionsIn(props, propsPointer)
    .filter(({ key }) => bindingKeys.has(key))
    .map(({ pointer, key }) => ({
      pointer,
      detail: `${key} takes an answer from the reader, which this message cannot; write { $state: /input/<field> } to show a value`,
    }));
}

function propsFitIssues(target: Target, element: Written, pointer: string): readonly CardIssue[] {
  const { type, props, repeat } = element;
  const definition = typeof type === 'string' && hasKey(target.components, type) ? target.components[type] : undefined;
  const writesExpressions = expressionsIn(props, '').length > 0 || repeat !== undefined;
  if (definition === undefined || writesExpressions) {
    return [];
  }
  const parsed = definition.props.safeParse(props ?? {});
  return (parsed.error?.issues ?? []).map(({ path, message }) => ({
    pointer: path.reduce<string>((at, segment) => pointerTo(at, segment), pointerTo(pointer, 'props')),
    detail: `This does not fit a ${String(type)}: ${message}`,
  }));
}

function propsIssues(target: Target, element: Written, pointer: string): readonly CardIssue[] {
  const { props } = element;
  const propsPointer = pointerTo(pointer, 'props');
  if (props !== undefined && !isRecord(props)) {
    return [{ pointer: propsPointer, detail: 'Write `props` as a mapping' }];
  }
  return [...bindingIssues(propsPointer, props), ...propsFitIssues(target, element, pointer)];
}

function elementIssues(target: Target, elements: Written, id: string, element: unknown): readonly CardIssue[] {
  const pointer = pointerTo('/elements', id);
  if (!isRecord(element)) {
    return [{ pointer, detail: 'Write the element as a mapping with `type`, `props` and `children`' }];
  }
  return [
    ...typeIssues(target, pointer, element['type']),
    ...childIssues(elements, pointer, element['children']),
    ...propsIssues(target, element, pointer),
  ];
}

export function cardIssues(targetName: RenderTargetName, written: unknown): readonly CardIssue[] {
  if (!isRecord(written)) {
    return [{ pointer: '', detail: 'Write the body as a mapping with `root` and `elements`' }];
  }
  const target = renderTargetOf(targetName);
  const { elements } = written;
  const elementIssuesOfAll = isRecord(elements)
    ? entriesOf(elements).flatMap(([id, element]) => elementIssues(target, elements, id, element))
    : [];
  return [...topLevelIssues(written), ...elementIssuesOfAll];
}
