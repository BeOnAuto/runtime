import {
  GraphQLBoolean,
  GraphQLError,
  GraphQLFloat,
  GraphQLScalarType,
  GraphQLString,
  Kind,
  valueFromASTUntyped,
  type ConstValueNode,
} from 'graphql';

import { kindOfValue, type ScalarKind } from './json-schema-reading.ts';

function literalOf(node: ConstValueNode): unknown {
  if (node.kind === Kind.INT || node.kind === Kind.FLOAT) return Number(node.value);
  return node.kind === Kind.STRING || node.kind === Kind.BOOLEAN ? node.value : undefined;
}

export function scalarOfKinds(kinds: readonly ScalarKind[]): GraphQLScalarType {
  const name = kinds.join('Or');
  const accepted = (value: unknown) => {
    const kind = kindOfValue(value);
    if (kind === undefined || !kinds.includes(kind)) {
      throw new GraphQLError(`A value of ${name} is one of ${kinds.join(', ')}`);
    }
    return value;
  };
  return new GraphQLScalarType({
    name,
    description: `A value that is any one of ${kinds.join(', ')}`,
    coerceOutputValue: accepted,
    coerceInputValue: accepted,
    coerceInputLiteral: (node) => accepted(literalOf(node)),
  });
}

export const jsonScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'A JSON value: a free-form document, a map or a value of more than one shape',
  coerceOutputValue: (value) => value,
  coerceInputValue: (value) => value,
  coerceInputLiteral: (node) => valueFromASTUntyped(node),
});

export const singleScalars: Readonly<Record<ScalarKind, GraphQLScalarType>> = {
  String: GraphQLString,
  Number: GraphQLFloat,
  Boolean: GraphQLBoolean,
};
