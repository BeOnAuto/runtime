import { listed } from '@on.auto/phrasing';

import { chartKindNamed, chartKinds, type ChartKind, type ChartRole } from './chart-kinds.ts';

export interface ChartInfo {
  readonly kind: ChartKind;
  readonly roles: ReadonlyMap<ChartRole, string>;
}

export type ChartInfoReading = { readonly info: ChartInfo } | { readonly refused: string } | { readonly other: true };

const words = /[^\s"=]+="[^"]*"|\S+/gu;

const roleWord = /^([^\s"=]+)=(?:"([^"]*)"|(\S+))$/u;

const kindsInWords = chartKinds.map(({ name }) => name).join(', ');

function roleRefused({ noun, needs, may }: ChartKind, given: string): string {
  const roles = [...needs, ...may];
  return roles.length === 0
    ? `${noun} supports no roles; leave out ${given}`
    : `${noun} supports ${listed(roles)}; ${given} is not supported`;
}

type RolesReading = { readonly roles: ReadonlyMap<ChartRole, string> } | { readonly refused: string };

function roleOf(kind: ChartKind, name: string): ChartRole | undefined {
  return [...kind.needs, ...kind.may].find((role) => role === name);
}

function rolesOf(kind: ChartKind, written: readonly string[]): RolesReading {
  const roles = new Map<ChartRole, string>();
  for (const word of written) {
    const parts = roleWord.exec(word);
    if (parts === null) {
      return { refused: `${word} is not a valid role assignment; use role=column, such as x=Channel` };
    }
    const role = roleOf(kind, String(parts[1]));
    if (role === undefined) {
      return { refused: roleRefused(kind, String(parts[1])) };
    }
    if (roles.has(role)) {
      return { refused: `the role ${role} is assigned twice` };
    }
    roles.set(role, parts[2] ?? String(parts[3]));
  }
  return { roles };
}

export function chartInfoOf(info: string): ChartInfoReading {
  const [first, named, ...written] = info.match(words) ?? [];
  if (first !== 'chart') {
    return { other: true };
  }
  const kind = named === undefined ? undefined : chartKindNamed(named);
  if (kind === undefined) {
    return { refused: `specify a chart type after chart: ${kindsInWords}` };
  }
  const roles = rolesOf(kind, written);
  return 'refused' in roles ? roles : { info: { kind, roles: roles.roles } };
}
