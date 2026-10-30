import { problemAt, type SettingProblem } from './setting-values.ts';

const setting = 'MODEL_GATEWAYS';

const mostAllowedFields = 64;

const mostFieldCharacters = 64;

const runtimeFields: ReadonlySet<string> = new Set([
  'model',
  'messages',
  'stream',
  'stream_options',
  'n',
  'max_tokens',
  'max_completion_tokens',
  'temperature',
  'top_p',
  'frequency_penalty',
  'presence_penalty',
  'seed',
  'stop',
  'response_format',
  'tools',
  'tool_choice',
  'functions',
  'function_call',
  'reasoning_effort',
  'verbosity',
  'reasoningEffort',
  'textVerbosity',
  'strictJsonSchema',
]);

function fieldProblems(
  field: string,
  position: number,
  fields: readonly string[],
  at: string,
): readonly SettingProblem[] {
  const pointer = `${at}/${position}`;
  if (field.length === 0 || field.length > mostFieldCharacters) {
    return problemAt(setting, pointer, `Expected a field name of 1 to ${mostFieldCharacters} characters`);
  }
  if (runtimeFields.has(field)) {
    return problemAt(
      setting,
      pointer,
      `${field} is set by the runtime or changes what the call is, so it cannot be allowed`,
    );
  }
  return fields.indexOf(field) < position ? problemAt(setting, pointer, `${field} is listed twice`) : [];
}

export function allowedOptionProblems(fields: readonly string[], index: number): readonly SettingProblem[] {
  const at = `/${index}/allowed_provider_options`;
  if (fields.length > mostAllowedFields) {
    return problemAt(setting, at, `Expected at most ${mostAllowedFields} field names`);
  }
  return fields.flatMap((field, position) => fieldProblems(field, position, fields, at));
}
