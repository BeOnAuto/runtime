export const MOST_ORG_NAME_LENGTH = 80;

const CONTROLS = /\p{Cc}+/gu;

const FORMATS = /\p{Cf}+/gu;

const SPACES = /\s+/gu;

export function shownOrgName(name: string | null | undefined): string | null {
  const oneLine = (name ?? '').replace(FORMATS, '').replace(CONTROLS, ' ').replace(SPACES, ' ').trim();
  const shown = Array.from(oneLine).slice(0, MOST_ORG_NAME_LENGTH).join('').trim();
  return shown === '' ? null : shown;
}
