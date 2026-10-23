import type { registerSchema, validate } from '@hyperjump/json-schema/draft-2020-12';
import type { buildGraph, Classes } from '@openworkflowspec/sdk';

export interface SpecificationSdk {
  readonly workflowSchema: unknown;
  readonly buildGraph: typeof buildGraph;
  readonly Classes: typeof Classes;
}

export interface SchemaValidator {
  readonly registerSchema: typeof registerSchema;
  readonly validate: typeof validate;
}

let loadingSdk: Promise<SpecificationSdk> | undefined;

let loadingValidator: Promise<SchemaValidator> | undefined;

export function specificationSdk(): Promise<SpecificationSdk> {
  loadingSdk ??= import('@openworkflowspec/sdk');
  return loadingSdk;
}

export function schemaValidator(): Promise<SchemaValidator> {
  loadingValidator ??= validatorAssertingFormats();
  return loadingValidator;
}

async function validatorAssertingFormats(): Promise<SchemaValidator> {
  const [validator, { addFormat }, formats] = await Promise.all([
    import('@hyperjump/json-schema/draft-2020-12'),
    import('@hyperjump/json-schema/experimental'),
    import('@hyperjump/json-schema-formats'),
  ]);
  const formatChecks: ReadonlyMap<string, (text: string) => boolean> = new Map([
    ['date-time', formats.isDateTime],
    ['json-pointer', formats.isJsonPointer],
    ['uri', formats.isUri],
    ['uri-template', formats.isUriTemplate],
  ]);
  validator.setShouldValidateFormat(true);
  for (const [name, isFormat] of formatChecks) {
    addFormat({
      id: `https://json-schema.org/format/${name}`,
      handler: (value: unknown) => typeof value !== 'string' || isFormat(value),
    });
  }
  return validator;
}
