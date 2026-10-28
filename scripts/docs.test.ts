import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';

import manifest from '../package.json' with { type: 'json' };

const docs = resolve(import.meta.dirname, '../docs');
const output = join(docs, '.vitepress/dist');
const markdownDestinations = (source: string): readonly string[] =>
  [...source.matchAll(/\]\(([^)]+)\)/gu)]
    .map((match: readonly string[]) => match[1])
    .filter((href) => href !== undefined);
const navigation = readFileSync(join(docs, 'nav.json'), 'utf8');
const pages = readdirSync(docs, { recursive: true, withFileTypes: true })
  .filter(
    (entry: Readonly<Dirent>) =>
      entry.isFile() && entry.name.endsWith('.md') && !entry.parentPath.includes('.vitepress'),
  )
  .map((entry: Readonly<Dirent>) => join(entry.parentPath, entry.name));
const repositoryOnlyDirectories = ['engineering'];
const publicPages = pages.filter(
  (page) => !repositoryOnlyDirectories.some((directory) => relative(docs, page).startsWith(`${directory}/`)),
);
const routes = [...navigation.matchAll(/"link"\s*:\s*"([^"]+)"/gu)]
  .map((match: readonly string[]) => match[1])
  .filter((route) => route !== undefined);
const navigationGroups = [...navigation.matchAll(/"text"\s*:\s*"([^"]+)"\s*,\s*"items"\s*:/gu)]
  .map((match: readonly string[]) => match[1])
  .filter((group) => group !== undefined);
const guides = publicPages.filter(
  (page) => page !== join(docs, 'index.md') && !/^search: false$/mu.test(readFileSync(page, 'utf8')),
);
const renderedPages = publicPages.map((page) => {
  const filename = relative(docs, page).replace(/\.md$/u, '.html');
  return { page, filename, html: readFileSync(join(output, filename), 'utf8') };
});
const localLinks = renderedPages.flatMap(({ filename, html }: Readonly<{ filename: string; html: string }>) =>
  [...html.matchAll(/<a\s[^>]*href="([^"\s]+)"/gu)]
    .map((match: readonly string[]) => match[1])
    .filter((href) => href !== undefined)
    .filter((href) => href.startsWith('/docs/') || href.startsWith('#'))
    .map((href) => {
      const url = new URL(href, `https://preview.test/docs/${filename}`);
      const path = decodeURIComponent(url.pathname).replace(/^\/docs\//u, '');
      const target = path.endsWith('/') || path === '' ? `${path}index.html` : `${path.replace(/\.html$/u, '')}.html`;
      return { filename, href, target, fragment: decodeURIComponent(url.hash.slice(1)) };
    }),
);
const fragmentLinks = localLinks.filter(({ fragment }: Readonly<{ fragment: string }>) => fragment !== '');
const markdownLinks = publicPages.flatMap((page) =>
  [...readFileSync(page, 'utf8').matchAll(/\]\(([^)]+\.md)(?:#[^)]*)?\)/gu)]
    .map((match: readonly string[]) => match[1])
    .filter((href) => href !== undefined)
    .filter((href) => !/^https?:/u.test(href))
    .map((href) => ({ page, href, target: resolve(dirname(page), href) })),
);

await test('navigation has unique routes and points to source pages', () => {
  assert.equal(routes.length, new Set(routes).size);
  for (const route of routes) {
    assert.match(route, /^\/(?!docs\/)[a-z0-9/-]+$/u);
    assert.ok(existsSync(join(docs, `${route}.md`)), `Navigation target missing: ${route}`);
  }
});

await test('navigation covers every guide and source pages have titles', () => {
  for (const page of publicPages) assert.match(readFileSync(page, 'utf8'), /^# .+/mu, `${page} needs a title`);
  for (const page of guides) {
    const route = `/${relative(docs, page).replace(/\.md$/u, '')}`;
    assert.ok(routes.includes(route), `Guide missing from navigation: ${route}`);
  }
});

await test('the public preview builds all pages with public edit links and a documentation base', () => {
  for (const { page, filename, html } of renderedPages) {
    assert.ok(html.includes('/docs/assets/'), `${filename} assets need the documentation base`);
    assert.ok(
      html.includes(`https://github.com/BeOnAuto/runtime/edit/main/docs/${relative(docs, page)}`),
      `${filename} needs a public source edit link`,
    );
  }
});

await test('rendered local navigation resolves', () => {
  for (const { target, filename, href } of localLinks) {
    assert.ok(existsSync(join(output, target)), `${filename} links to missing page ${href}`);
  }
});

await test('rendered fragment links resolve', () => {
  for (const { target, fragment, filename, href } of fragmentLinks) {
    const html = readFileSync(join(output, target), 'utf8');
    assert.ok(html.includes(`id="${fragment}"`), `${filename} links to missing anchor ${href}`);
  }
});

await test('guide Markdown does not depend on private source files', () => {
  for (const { target, page, href } of markdownLinks) {
    assert.ok(target.startsWith(`${docs}/`), `${page} escapes documentation source: ${href}`);
    assert.ok(existsSync(target), `${page} links to missing Markdown: ${href}`);
    assert.ok(publicPages.includes(target), `${page} links to an unpublished source page: ${href}`);
  }
});

await test('engineering guides remain in the repository without entering the public preview', () => {
  assert.ok(pages.includes(join(docs, 'engineering/index.md')));
  assert.ok(pages.includes(join(docs, 'engineering/self-host/installation.md')));
  assert.ok(pages.includes(join(docs, 'engineering/reference/workflow-format.md')));
  for (const directory of repositoryOnlyDirectories) {
    assert.equal(existsSync(join(output, directory)), false);
    assert.equal(
      routes.some((route) => route.startsWith(`/${directory}/`)),
      false,
    );
    for (const { html } of renderedPages) assert.equal(html.includes(`href="/docs/${directory}/`), false);
  }
});

await test('public docs lead to hosted Auto and make self-hosting a contact-led choice', () => {
  const selfHost = readFileSync(join(docs, 'self-host.md'), 'utf8');
  assert.ok(markdownDestinations(selfHost).includes('https://on.auto/contact-us'));
  assert.doesNotMatch(selfHost, /```|npx|docker run/u);
  const index = readFileSync(join(docs, 'index.md'), 'utf8');
  const destinations = markdownDestinations(index);
  assert.ok(destinations.includes('get-started/cloud.md'));
  assert.ok(destinations.indexOf('get-started/cloud.md') < destinations.indexOf('self-host.md'));
  assert.ok(!routes.includes('/get-started/local'));
  assert.ok(!routes.some((route) => route.startsWith('/self-host/')));
  for (const page of publicPages.filter((candidate) => relative(docs, candidate).startsWith('self-host/'))) {
    assert.match(readFileSync(page, 'utf8'), /^search: false$/mu);
    assert.match(readFileSync(page, 'utf8'), /content: noindex, follow/u);
  }
});

await test('documentation link checks compare the complete Markdown destination', () => {
  const expected = 'https://on.auto/docs/get-started/local';
  assert.deepEqual(markdownDestinations(`[Connect](${expected})`), [expected]);
  const misleading = [
    `[Wrong host](https://on.auto.example.test/docs/get-started/local)`,
    `[Wrong path](https://example.test/${expected})`,
    `[Unrelated text](https://example.test/) ${expected}`,
  ];
  for (const source of misleading) {
    assert.equal(
      markdownDestinations(source).some((href) => href === expected),
      false,
    );
  }
});

await test('navigation separates concepts, learning, guides and reference', () => {
  assert.deepEqual(navigationGroups, [
    'Get started',
    'Tutorials',
    'Concepts',
    'Guides',
    'Build functions',
    'Run and inspect',
    'Connect data',
    'Self-hosting',
    'Reference',
    'Contributing',
  ]);
  assert.ok(routes.includes('/tutorials/first-playbook'));
  assert.ok(routes.indexOf('/get-started/cloud') < routes.indexOf('/tutorials/first-playbook'));
  assert.ok(routes.includes('/self-host'));
  const mcp = readFileSync(join(docs, 'reference/mcp.md'), 'utf8');
  assert.match(mcp, /^# MCP reference/mu);
  assert.ok(mcp.includes('../tutorials/first-playbook.md'));
  assert.doesNotMatch(mcp, /Given what you know about my work|## Start with work/u);
});

await test('the first-playbook tutorial supplies inputs and observable checks for two runs', () => {
  const tutorial = readFileSync(join(docs, 'tutorials/first-playbook.md'), 'utf8');
  const inputs = [...tutorial.matchAll(/```text\n([\s\S]*?)```/gu)].map((match: readonly string[]) => match[1]);
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0]?.includes('Total budget: USD 8,000'), true);
  assert.equal(inputs[0]?.includes('Success measure: Generate interest in the product'), true);
  assert.equal(inputs[1]?.includes('Finance directors at UK manufacturing companies'), true);
  assert.equal(inputs[1]?.includes('Success measure: 100 trial registrations'), true);
  assert.ok(markdownDestinations(tutorial).includes('../get-started/cloud.md'));
  assert.ok(tutorial.includes('review-campaign-brief'));
  assert.ok(tutorial.includes('USD 10,000'));
  assert.ok(tutorial.includes('status: succeeded'));
  assert.ok(tutorial.includes('different run ids'));
  assert.ok(tutorial.includes('same definition version'));
  assert.doesNotMatch(tutorial, /localhost|127\.0\.0\.1|claude-|gpt-/u);
});

await test('the local quick start gives runnable setup and points teams to self-hosting', () => {
  const guide = readFileSync(join(docs, 'get-started/local.md'), 'utf8');
  for (const command of [
    `claude mcp add -s user auto-runtime -- npx -y @on.auto/runtime@${manifest.version} mcp`,
    `codex mcp add auto-runtime -- npx -y @on.auto/runtime@${manifest.version} mcp`,
    `gemini mcp add -s user auto-runtime npx -y @on.auto/runtime@${manifest.version} mcp`,
    `grok mcp add -s user auto-runtime npx -- -y @on.auto/runtime@${manifest.version} mcp`,
    'npx @on.auto/runtime status',
    '`npx @on.auto/runtime` starts Auto',
    'claude mcp add --transport http auto-runtime https://auto.example.com/mcp',
  ])
    assert.ok(guide.includes(command), `Missing quick-start command: ${command}`);
  assert.ok(guide.includes('ANTHROPIC_API_KEY='));
  assert.ok(guide.includes("Your agent's subscription does not cover it"));
  assert.ok(guide.includes('Never paste the key into the conversation'));
  assert.ok(guide.includes('Claude Desktop'));
  assert.ok(guide.includes('## 1. Add Auto to your agent {#connect-your-agent}'));
  assert.ok(guide.includes('Do not expose Auto on your computer through a tunnel or public proxy'));
  assert.ok(guide.includes('`http://localhost:5555`'));
  assert.doesNotMatch(guide, /Prefer a hosted brain\b/u);
  assert.ok(markdownDestinations(guide).includes('../self-host.md'));
  assert.ok(markdownDestinations(guide).includes('../tutorials/first-playbook.md'));
  assert.ok(markdownDestinations(guide).includes('../self-host/models.md'));
});

await test('model discovery is documented without treating wildcard entries as runnable models', () => {
  const mcp = readFileSync(join(docs, 'reference/mcp.md'), 'utf8');
  const http = readFileSync(join(docs, 'reference/http.md'), 'utf8');
  const tutorial = readFileSync(join(docs, 'tutorials/first-playbook.md'), 'utf8');
  assert.ok(mcp.includes('`list_models`'));
  assert.ok(mcp.includes('requires `org:read`'));
  assert.ok(mcp.includes('not available on a playbook-scoped endpoint'));
  assert.ok(mcp.includes('`catalog_status: "partial"`'));
  assert.ok(mcp.includes('not a model to run'));
  assert.ok(http.includes('GET /v1/orgs/{org}/models'));
  assert.ok(tutorial.includes('Use one of the models Auto can use'));
  assert.ok(tutorial.includes('Do not use a wildcard'));
});

await test('public workflows are available and link their format and tutorial, while the runnable walkthroughs stay out of the public routes', () => {
  const workflows = readFileSync(join(docs, 'concepts/workflows.md'), 'utf8');
  const functions = readFileSync(join(docs, 'concepts/functions.md'), 'utf8');
  const tutorial = readFileSync(join(docs, 'tutorials/first-workflow.md'), 'utf8');
  assert.doesNotMatch(workflows, /coming soon/iu);
  assert.ok(functions.includes('Workflows are available and coordinate the functions above'));
  for (const page of publicPages) assert.doesNotMatch(readFileSync(page, 'utf8'), /workflow service/iu);
  assert.doesNotMatch(workflows, /```(?:yaml|sh|bash|json)/u);
  assert.ok(markdownDestinations(workflows).includes('../reference/workflow-format.md'));
  assert.ok(markdownDestinations(workflows).includes('../tutorials/first-workflow.md'));
  assert.ok(routes.includes('/reference/workflow-format'));
  assert.ok(routes.includes('/tutorials/first-workflow'));
  assert.ok(tutorial.includes('Draft brief feedback'));
  assert.doesNotMatch(tutorial, /answer_interaction|type: interaction/u);
  assert.ok(tutorial.includes('status: succeeded'));
  assert.doesNotMatch(tutorial, /localhost|127\.0\.0\.1|claude-|gpt-/u);
  const removedPages = ['get-started/self-hosted', 'reference/http-tutorial'];
  for (const page of removedPages) {
    assert.equal(routes.includes(`/${page}`), false);
    assert.equal(existsSync(join(output, `${page}.html`)), false);
  }
});

await test('computation functions are available in every runtime, with their format beside the other formats', () => {
  const functions = readFileSync(join(docs, 'concepts/functions.md'), 'utf8');
  const format = readFileSync(join(docs, 'reference/computation-format.md'), 'utf8');
  assert.ok(functions.includes('reasoning, interaction, prediction, recall and computation functions are available'));
  assert.ok(markdownDestinations(functions).includes('../reference/computation-format.md'));
  assert.ok(routes.indexOf('/reference/reasoning-format') < routes.indexOf('/reference/computation-format'));
  assert.ok(routes.indexOf('/reference/computation-format') < routes.indexOf('/reference/workflow-format'));
  assert.ok(format.includes('Computation functions are available in every runtime.'));
  assert.ok(format.includes('compute money in whole minor units'));
  for (const page of publicPages) assert.doesNotMatch(readFileSync(page, 'utf8'), /compute functions?\b/iu);
});
