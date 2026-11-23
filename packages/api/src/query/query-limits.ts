import {
  GraphQLError,
  Kind,
  getNamedType,
  getNullableType,
  getOperationAST,
  isListType,
  isObjectType,
  type DocumentNode,
  type FieldNode,
  type FragmentDefinitionNode,
  type GraphQLNamedType,
  type GraphQLSchema,
  type SelectionSetNode,
} from 'graphql';

export interface QueryLimits {
  readonly depth: number;
  readonly aliases: number;
  readonly rootFields: number;
  readonly cost: number;
  readonly listSize: number;
}

export const QUERY_LIMITS: QueryLimits = { depth: 16, aliases: 30, rootFields: 30, cost: 50000, listSize: 100 };

interface Measured {
  readonly depth: number;
  readonly aliases: number;
  readonly fields: number;
  readonly cost: number;
}

const nothing: Measured = { depth: 0, aliases: 0, fields: 0, cost: 0 };

function summed(left: Measured, right: Measured): Measured {
  return {
    depth: Math.max(left.depth, right.depth),
    aliases: left.aliases + right.aliases,
    fields: left.fields + right.fields,
    cost: left.cost + right.cost,
  };
}

interface Measuring {
  readonly typeNamed: (name: string) => GraphQLNamedType | undefined;
  readonly fragmentNamed: (name: string) => FragmentDefinitionNode | undefined;
  readonly listSize: number;
  readonly mostListed: number;
}

function measuringInside(measuring: Measuring, selection: FieldNode, reads: boolean): Measuring {
  if (!reads) return measuring;
  const limit = selection.arguments?.find((argument) => argument.name.value === 'limit')?.value;
  const listSize =
    limit?.kind === Kind.INT ? Math.min(Number(limit.value), measuring.mostListed) : measuring.mostListed;
  return { ...measuring, listSize };
}

function fieldMeasured(
  measuring: Measuring,
  selection: FieldNode,
  parent: GraphQLNamedType | null | undefined,
  multiplier: number,
): Measured {
  const field = isObjectType(parent) ? parent.getFields()[selection.name.value] : undefined;
  const reads = field?.extensions['reads'] === true;
  const below = field !== undefined && isListType(getNullableType(field.type)) ? measuring.listSize : 1;
  const inside = measuringInside(measuring, selection, reads);
  const inner =
    selection.selectionSet === undefined || field === undefined
      ? nothing
      : measured(inside, selection.selectionSet, getNamedType(field.type), multiplier * below);
  return {
    depth: inner.depth + 1,
    aliases: inner.aliases + (reads && selection.alias !== undefined ? 1 : 0),
    fields: 1,
    cost: inner.cost + (reads ? multiplier : 0),
  };
}

function measured(
  measuring: Measuring,
  selectionSet: SelectionSetNode,
  parent: GraphQLNamedType | null | undefined,
  multiplier: number,
): Measured {
  return selectionSet.selections
    .map((selection): Measured => {
      if (selection.kind === Kind.FIELD) return fieldMeasured(measuring, selection, parent, multiplier);
      const fragment =
        selection.kind === Kind.INLINE_FRAGMENT ? selection : measuring.fragmentNamed(selection.name.value);
      if (fragment === undefined) return nothing;
      const condition = fragment.typeCondition?.name.value;
      const type = condition === undefined ? parent : measuring.typeNamed(condition);
      return measured(measuring, fragment.selectionSet, type, multiplier);
    })
    .reduce((total, each) => summed(total, each), nothing);
}

function brokenWhere(over: boolean, code: string, message: string): readonly GraphQLError[] {
  return over ? [new GraphQLError(message, { extensions: { code } })] : [];
}

export function limitsBrokenBy(
  schema: GraphQLSchema,
  document: DocumentNode,
  operationName: string | undefined,
  limits: QueryLimits,
): readonly GraphQLError[] {
  const operation = getOperationAST(document, operationName) ?? undefined;
  if (operation === undefined) return [];
  const fragments = new Map(
    document.definitions.flatMap((definition) =>
      definition.kind === Kind.FRAGMENT_DEFINITION ? [[definition.name.value, definition] as const] : [],
    ),
  );
  const measure = measured(
    {
      typeNamed: (name) => schema.getType(name),
      fragmentNamed: (name) => fragments.get(name),
      listSize: limits.listSize,
      mostListed: limits.listSize,
    },
    operation.selectionSet,
    schema.getQueryType(),
    1,
  );
  return [
    ...brokenWhere(
      measure.depth > limits.depth,
      'query_too_deep',
      `The query nests fields deeper than ${limits.depth}`,
    ),
    ...brokenWhere(
      measure.aliases > limits.aliases,
      'too_many_aliases',
      `The query gives more than ${limits.aliases} reads an alias`,
    ),
    ...brokenWhere(
      measure.fields > limits.rootFields,
      'too_many_root_fields',
      `The query asks for more than ${limits.rootFields} fields at its root`,
    ),
    ...brokenWhere(
      measure.cost > limits.cost,
      'query_too_costly',
      `The query could make more than ${limits.cost} reads, counting ${limits.listSize} for each item of a list`,
    ),
  ];
}
