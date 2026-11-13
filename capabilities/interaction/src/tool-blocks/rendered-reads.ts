import { parsedTemplate } from '@on.auto/definitions/template';
import { toolBlockEngine, type Templates } from '@on.auto/definitions/tool-blocks';
import { Result, type Schema } from 'effect';

function textsIn(value: Schema.Json): readonly string[] {
  if (typeof value === 'string') {
    return [value];
  }
  return value !== null && typeof value === 'object' ? Object.values(value).flatMap((item) => textsIn(item)) : [];
}

function readsRenderedText(text: string): boolean {
  const parsed = parsedTemplate(toolBlockEngine, text, 1);
  return Result.isSuccess(parsed) && parsed.success.variables.some(({ path }) => path[0] === 'rendered');
}

export function readsRendered(templates: Templates): boolean {
  return textsIn(templates).some((text) => readsRenderedText(text));
}
