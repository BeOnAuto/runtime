export { blankPlacesIn, blanksStanding, type BlankPlace, type StandingBlank } from './portable/blanks.ts';
export {
  leftOutTexts,
  packageLeftOut,
  packageResolution,
  resolutionOf,
  type Decisions,
  type LeaveOut,
  type LeftStanding,
  type Resolution,
} from './portable/leaving-out.ts';
export {
  packageWithTexts,
  textsOfPackage,
  type DefinitionField,
  type PortablePart,
  type PortableText,
  type TextPlace,
} from './portable/package-texts.ts';
export {
  needsOf,
  portableExportOf,
  type NeededConnection,
  type PortableExport,
  type PortableNeeds,
} from './portable/portable-export.ts';
export {
  PORTABLE_FORMAT,
  PORTABLE_MAX_BYTES,
  PORTABLE_MAX_DEFINITIONS,
  canonicalJson,
  inCreationOrder,
  packageCapIssues,
  packageDigest,
  type CreatedDefinition,
  type PortableDefinition,
  type PortablePackage,
} from './portable/portable-package.ts';
export type { ValueClass } from './portable/value-classes.ts';
export {
  findingId,
  findingsIn,
  scanFormOf,
  type Finding,
  type Occurrence,
  type ScanForm,
} from './portable/value-scan.ts';
