import { createHash } from 'node:crypto';

import { standardComponentDefinitions } from '@json-render/chat';
import type { CardChild, CardElement } from 'chat';
import { Option, Schema } from 'effect';
import { z } from 'zod';

import { decidedWords } from '../replies/telling-words.ts';
import { decidedBy, isDecided, valueAt } from './answer-places.ts';
import type { ReadonlyDeep } from './readonly-deep.ts';

export const answerButtonMarker = 'auto-answer:';

export const PartSchema = Schema.Struct({ at: Schema.String, value: Schema.Json });

export type Part = typeof PartSchema.Type;

export interface AnswerButton {
  readonly id: string;
  readonly label: string;
  readonly sets: readonly Part[];
  readonly once?: true;
}

const KeptSchema = Schema.Struct({ sets: Schema.Array(PartSchema), once: Schema.Boolean });

const idLength = 20;

function idOf(label: string, sets: readonly unknown[]): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([label, sets]))
    .digest('hex');
  return `${answerButtonMarker}${digest.slice(0, idLength)}`;
}

const SetWrittenSchema = z.object({ at: z.string().startsWith('/'), value: z.json() });

const ButtonPropsSchema = z.object({
  label: z.string().min(1),
  style: z.enum(['primary', 'danger']).nullish(),
  sets: z.array(SetWrittenSchema).min(1),
  once: z.boolean().optional(),
});

interface WrittenButton {
  readonly label: string;
  readonly style?: 'primary' | 'danger' | null | undefined;
  readonly sets: readonly Readonly<{ at: string; value: unknown }>[];
  readonly once?: boolean | undefined;
}

const AnswerButtonPropsSchema = ButtonPropsSchema.transform(({ label, style, sets, once }: WrittenButton) => ({
  id: idOf(label, sets),
  label,
  style,
  value: JSON.stringify({ sets, once: once === true }),
}));

const answerButtonDefinition = {
  props: z.union([AnswerButtonPropsSchema, standardComponentDefinitions.Button.props]),
};

export const slackComponents = { ...standardComponentDefinitions, Button: answerButtonDefinition };

const decodeKept = Schema.decodeUnknownOption(Schema.fromJsonString(KeptSchema));

type Child = ReadonlyDeep<CardChild>;

type ButtonChild = Extract<Child, { type: 'actions' }>['children'][number];

function isAnswerButton(child: ButtonChild): child is Extract<ButtonChild, { type: 'button' }> {
  return child.type === 'button' && child.id.startsWith(answerButtonMarker);
}

function buttonOf(child: ButtonChild): readonly AnswerButton[] {
  if (!isAnswerButton(child)) {
    return [];
  }
  const kept = Option.getOrUndefined(decodeKept(child.value));
  return kept === undefined
    ? []
    : [{ id: child.id, label: child.label, sets: kept.sets, ...(kept.once ? { once: true as const } : {}) }];
}

function buttonsIn(child: Child): readonly AnswerButton[] {
  if (child.type === 'actions') {
    return child.children.flatMap((button) => buttonOf(button));
  }
  return child.type === 'section' ? child.children.flatMap((inner) => buttonsIn(inner)) : [];
}

export function answerButtonsOf(card: ReadonlyDeep<CardElement>): readonly AnswerButton[] {
  const found = card.children.flatMap((child) => buttonsIn(child));
  return found.filter(({ id }, index) => found.findIndex((other) => other.id === id) === index);
}

export interface Shown {
  readonly answer: Schema.Json;
  readonly answered: Schema.Json;
  readonly over?: 'answered' | 'closed';
}

type Row = Extract<Child, { type: 'actions' }>;

function rowButtonsOf(row: Row): readonly AnswerButton[] {
  return row.children.flatMap((button) => buttonOf(button));
}

function isLive(button: Row['children'][number], { answered, over }: Shown): boolean {
  const [answering] = isAnswerButton(button) ? buttonOf(button) : [];
  if (answering === undefined) {
    return true;
  }
  return over === undefined && !(answering.once === true && answering.sets.every(({ at }) => isDecided(answered, at)));
}

function sameValue(one: Schema.Json, other: Schema.Json): boolean {
  return JSON.stringify(one) === JSON.stringify(other);
}

function chosenBy(buttons: readonly AnswerButton[], places: readonly string[], answer: Schema.Json) {
  return buttons.find((button) =>
    places.every((at) => button.sets.some((set) => set.at === at && sameValue(set.value, valueAt(answer, at)))),
  );
}

function lineOf(buttons: readonly AnswerButton[], { answer, answered, over }: Shown, named: Named): string {
  if (over === 'closed') {
    return decidedWords.closed;
  }
  const places = [...new Set(buttons.flatMap(({ sets }) => sets.map(({ at }) => at)))];
  const people = new Set(places.map((at) => decidedBy(answered, at)));
  const [person] = people.size === 1 ? people : [];
  if (person === undefined) {
    return decidedWords.answered;
  }
  const chosen = chosenBy(buttons, places, answer);
  return chosen === undefined
    ? decidedWords.answeredBy(named(person))
    : decidedWords.chosen(chosen.label, named(person));
}

type Named = (id: string) => string;

function decided(row: Row, shown: Shown, named: Named): readonly Child[] {
  const children = row.children.filter((button) => isLive(button, shown));
  if (children.length > 0) {
    return [{ ...row, children }];
  }
  return [{ type: 'text', content: lineOf(rowButtonsOf(row), shown, named), style: 'muted' }];
}

function inRows(child: Child, shown: Shown, named: Named): readonly Child[] {
  if (child.type === 'actions') {
    return rowButtonsOf(child).length === 0 ? [child] : decided(child, shown, named);
  }
  if (child.type === 'section') {
    return [{ ...child, children: child.children.flatMap((inner) => inRows(inner, shown, named)) }];
  }
  return [child];
}

export function withDecidedRows(
  card: ReadonlyDeep<CardElement>,
  shown: Shown,
  named: Named,
): ReadonlyDeep<CardElement> {
  return { ...card, children: card.children.flatMap((child) => inRows(child, shown, named)) };
}
