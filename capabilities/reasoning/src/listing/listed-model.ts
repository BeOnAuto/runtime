import { Predicate } from 'effect';

import { isModelId, namesAnArn } from '../model/model-reference.ts';

export interface ListedModel {
  readonly id: string;
  readonly created: number;
  readonly name?: string;
  readonly context_window?: number;
  readonly max_tokens?: number;
}

export interface ReportedDetails {
  readonly created?: unknown;
  readonly name?: unknown;
  readonly context_window?: unknown;
  readonly max_tokens?: unknown;
}

export interface ReportedModel extends ReportedDetails {
  readonly id: string;
}

const mostNameCharacters = 100;

const oneLine = /^[^\p{Cc}\p{Zl}\p{Zp}]+$/u;

function secondsOf(created: unknown): number {
  return Predicate.isNumber(created) && Number.isFinite(created) && created > 0 ? Math.floor(created) : 0;
}

function countOf(value: unknown): number | undefined {
  return Predicate.isNumber(value) && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function contextWindowOf(value: unknown): { readonly context_window?: number } {
  const count = countOf(value);
  return count === undefined ? {} : { context_window: count };
}

function maxTokensOf(value: unknown): { readonly max_tokens?: number } {
  const count = countOf(value);
  return count === undefined ? {} : { max_tokens: count };
}

function isShownName(name: string): boolean {
  return name.length <= mostNameCharacters && oneLine.test(name);
}

function nameOf(name: unknown): { readonly name?: string } {
  return Predicate.isString(name) && isShownName(name.trim()) ? { name: name.trim() } : {};
}

function isListable(id: string): boolean {
  return isModelId(id) && !id.includes('*') && !namesAnArn(id);
}

export function listedModel(id: string, { created, name, context_window, max_tokens }: ReportedDetails): ListedModel {
  return {
    id,
    created: secondsOf(created),
    ...nameOf(name),
    ...contextWindowOf(context_window),
    ...maxTokensOf(max_tokens),
  };
}

export function listedModels(provider: string, reported: readonly ReportedModel[]): readonly ListedModel[] {
  return reported
    .filter(({ id }) => isListable(id))
    .map(({ id, ...details }) => listedModel(`${provider}/${id}`, details));
}
