const dateFilters: ReadonlySet<string> = new Set([
  'date',
  'date_to_xmlschema',
  'date_to_rfc822',
  'date_to_string',
  'date_to_long_string',
]);

const tagsLeftOut: Readonly<Record<string, string>> = {
  include: 'The tag include is not available, since a page is a single document',
  render: 'The tag render is not available, since a page is a single document',
  layout: 'The tag layout is not available, since a page is a single document',
  block: 'The tag block is not available, since a page is a single document',
  capture: 'The tag capture is not available; build the text with assign and append instead',
  system: "The tag system is not available, since only a reasoning function's prompt has it",
  tablerow:
    'The tag tablerow is not available, since it writes HTML, which every client shows as text; write the rows with for',
};

const unknownFilter = /^undefined filter: (.+)$/u;

const unknownTag = /^tag "(.+)" not found$/u;

const openOutput = /^output "[\s\S]*" not closed$/u;

const openTag = /^tag \{%-?\s*(\w+)[\s\S]*%\} not closed$/u;

const openRaw = /^raw "[\s\S]*" not closed$/u;

function filterWords(name: string): string {
  return dateFilters.has(name)
    ? `The filter ${name} is not available, since it reads the server's clock and time zone; read today or now instead`
    : `The filter ${name} is not available; the templates guide lists the filters a template may use`;
}

function tagWords(name: string): string {
  return Object.hasOwn(tagsLeftOut, name)
    ? String(tagsLeftOut[name])
    : `The tag ${name} is not available; the page format lists the tags a page may use`;
}

export function pageTemplateWords(detail: string): string {
  const filter = unknownFilter.exec(detail)?.[1];
  const tag = unknownTag.exec(detail)?.[1];
  const opened = openTag.exec(detail)?.[1];
  if (filter !== undefined) {
    return filterWords(filter);
  }
  if (tag !== undefined) {
    return tagWords(tag);
  }
  if (opened !== undefined) {
    return `The tag ${opened} is not closed with {% end${opened} %}`;
  }
  if (openRaw.test(detail)) {
    return 'The tag raw is not closed with {% endraw %}';
  }
  return openOutput.test(detail) ? 'An output opened with {{ is not closed with }}' : detail;
}
