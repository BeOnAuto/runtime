import type { JsonOutput } from '../model/model-request.ts';
import type { ModelTarget } from '../model/model-resolution.ts';
import { portableFormOf, type PortableForm } from '../schema/portable-schema.ts';

export interface PortableMode {
  readonly mode: 'portable';
  readonly form: PortableForm;
}

export type AnswerMode = { readonly mode: 'described' } | PortableMode;

const described: AnswerMode = { mode: 'described' };

export function answerModeFor({ takesSchemas }: Pick<ModelTarget, 'takesSchemas'>, { schema }: JsonOutput): AnswerMode {
  if (!takesSchemas) {
    return described;
  }
  const form = portableFormOf(schema);
  return form.portable ? { mode: 'portable', form } : described;
}
