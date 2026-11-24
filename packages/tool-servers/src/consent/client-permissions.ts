import { Schema } from 'effect';

export const PermissionsStatedSchema = Schema.Literals(['application', 'delegated']);

export type PermissionsStated = typeof PermissionsStatedSchema.Type;

interface StatingPermissions {
  readonly permissions?: PermissionsStated | undefined;
}

const permissionsWhereNoneAreStated: PermissionsStated = 'delegated';

function permissionsStatedBy({ permissions }: StatingPermissions): PermissionsStated {
  return permissions ?? permissionsWhereNoneAreStated;
}

export function statesTheSamePermissions(one: StatingPermissions, other: StatingPermissions): boolean {
  return permissionsStatedBy(one) === permissionsStatedBy(other);
}
