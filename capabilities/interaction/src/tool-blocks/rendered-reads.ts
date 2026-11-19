import { parsedTemplate } from '@on.auto/definitions/template';
import { toolBlockEngine } from '@on.auto/definitions/tool-blocks';
import { Result, type Schema } from 'effect';

function textsIn(value: Schema.Json): readonly string[] {
  if (typeof value === 'string') {
    return [value];
  }
  return value !== null && typeof value === 'object' ? Object.values(value).flatMap((item) => textsIn(item)) : [];
}

function pathReads(path: readonly unknown[], name: string): boolean {
  return name.split('.').every((segment, index) => index >= path.length || String(path[index]) === segment);
}

function textReads(text: string, name: string): boolean {
  const parsed = parsedTemplate(toolBlockEngine, text, 1);
  return Result.isSuccess(parsed) && parsed.success.variables.some(({ path }) => pathReads(path, name));
}

export function readsVariable(templates: Schema.Json, name: string): boolean {
  return textsIn(templates).some((text) => textReads(text, name));
}
