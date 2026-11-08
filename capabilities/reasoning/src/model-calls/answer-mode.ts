import type { JsonOutput } from '../model/model-request.ts';
import type { ModelTarget } from '../model/model-resolution.ts';
import type { AnswerSchema } from '../schema/answer-schema.ts';
import { budgetOf } from '../schema/portable-checks.ts';
import { portableFormOf, type Portability, type PortableForm } from '../schema/portable-schema.ts';

export interface PortableMode {
  readonly mode: 'portable';
  readonly form: PortableForm;
}

export type AnswerMode = { readonly mode: 'described' } | PortableMode;

const described: AnswerMode = { mode: 'described' };

function formAsWritten({ document }: AnswerSchema): PortableForm {
  return { portable: true, sent: document, budget: budgetOf(document) };
}

function formSent({ schema, enforced_as_written: asWritten }: JsonOutput): Portability {
  return asWritten === true ? formAsWritten(schema) : portableFormOf(schema);
}

export function answerModeFor({ takesSchemas }: Pick<ModelTarget, 'takesSchemas'>, output: JsonOutput): AnswerMode {
  if (!takesSchemas) {
    return described;
  }
  const form = formSent(output);
  return form.portable ? { mode: 'portable', form } : described;
}
