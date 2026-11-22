import { sha256Of } from '@on.auto/content';

import type { DescribedError } from './cedar-decisions.ts';
import type { Cedar } from './cedar.ts';

interface PolicyTexts {
  readonly schema: string;
  readonly policies: string;
}

export interface PreparedPolicies {
  readonly cedar: Cedar;
  readonly schemaName: string;
  readonly policySetId: string;
  readonly policies: number;
}

export type PreparePolicies = (cedar: Cedar, texts: PolicyTexts) => PreparedPolicies;

interface Refusal {
  readonly policyId: string;
  readonly error: DescribedError;
}

type ReadIn = { readonly type: 'success' } | { readonly type: 'failure'; readonly errors: readonly DescribedError[] };

function joined(errors: readonly DescribedError[]): string {
  return errors.map(({ message }: DescribedError) => message).join('; ');
}

function idOf(cedar: Cedar, policy: string): string {
  const read = cedar.policyToJson(policy);
  const id = read.type === 'success' ? read.json.annotations?.['id'] : undefined;
  if (id === undefined || id === null) {
    throw new Error(`A policy has no @id: ${policy}`);
  }
  return id;
}

export function policiesById(cedar: Cedar, text: string): Readonly<Record<string, string>> {
  const parts = cedar.policySetTextToParts(text);
  if (parts.type === 'failure') {
    throw new Error(`The policies do not parse: ${joined(parts.errors)}`);
  }
  if (parts.policy_templates.length > 0) {
    throw new Error('The policies hold a template, which this decision point does not link');
  }
  const identified = parts.policies.map((policy): readonly [string, string] => [idOf(cedar, policy), policy]);
  const ids = identified.map(([id]) => id);
  const repeated = ids.find((id, index) => ids.indexOf(id) !== index);
  if (repeated !== undefined) {
    throw new Error(`The policy id ${repeated} is used more than once`);
  }
  return Object.fromEntries(identified);
}

function requireValid(cedar: Cedar, schema: string, policies: Readonly<Record<string, string>>): void {
  const validated = cedar.validate({
    validationSettings: { mode: 'strict' },
    schema,
    policies: { staticPolicies: { ...policies } },
  });
  if (validated.type === 'failure') {
    throw new Error(`The policies could not be validated: ${joined(validated.errors)}`);
  }
  const refused = validated.validationErrors.map(({ policyId, error }: Refusal) => `${policyId}: ${error.message}`);
  if (refused.length > 0) {
    throw new Error(`The policies do not pass the schema in strict mode: ${refused.join('; ')}`);
  }
}

function requireParsed(answer: ReadIn, what: string): void {
  if (answer.type === 'failure') {
    throw new Error(`The ${what} could not be read in: ${joined(answer.errors)}`);
  }
}

export function preparedPolicies(cedar: Cedar, { schema, policies }: PolicyTexts): PreparedPolicies {
  const byId = policiesById(cedar, policies);
  requireValid(cedar, schema, byId);
  const schemaName = `schema-${sha256Of(schema)}`;
  const policySetId = `policies-${sha256Of(JSON.stringify(byId))}`;
  requireParsed(cedar.preparseSchema(schemaName, schema), 'schema');
  requireParsed(cedar.preparsePolicySet(policySetId, { staticPolicies: { ...byId } }), 'policies');
  return { cedar, schemaName, policySetId, policies: Object.keys(byId).length };
}
