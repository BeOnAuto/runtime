import type { ToolDefinition } from '../model/model-request.ts';
import type { ModelWarning } from '../model/model-result.ts';
import { notPortableAsToolInput } from '../schema/answer-schema.ts';

export function inputSchemaWarnings(tools: readonly ToolDefinition[], provider: string): readonly ModelWarning[] {
  return tools.flatMap(({ name, inputSchema }) =>
    notPortableAsToolInput(inputSchema)
      .filter(({ providers }) => providers.includes(provider))
      .map(({ pointer, detail }): ModelWarning => ({
        type: 'compatibility',
        feature: `${name} inputSchema#${pointer}`,
        detail,
      })),
  );
}
