export { issueAt, issueText, reportedIssues, type DocumentIssue, type SourceLines } from './document/document-issue.ts';
export { splitDocument, type DocumentParts } from './document/document-split.ts';
export {
  frontMatterIn,
  type FrontMatterSection,
  type FrontMatterShape,
  type ReadFrontMatter,
} from './document/front-matter-keys.ts';
export { AboutSchema, DescriptionSchema, type ValueContract } from './document/function-fields.ts';
export { writtenTextIssues, type TextPosition } from './document/written-texts.ts';
