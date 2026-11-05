import { html, raw } from 'hono/html';
import { marked } from 'marked';

import type { Guide } from '../guides/guide-shelf.ts';
import type { AgentSurface, ShownPrompt, SurfaceConnection, SurfaceShelf } from './agent-surface.ts';
import { debugPageTitle } from './debug-style.ts';
import type { ShownArgument, ShownTool, ToolGroup } from './shown-tools.ts';

type Markup = ReturnType<typeof html>;

function markdownOf(text: string): Markup {
  return raw(marked.parse(text, { async: false }));
}

function idOf(prefix: string, part: string): string {
  return `${prefix}${part}`;
}

function limitOf({ oneOf, pattern, maxLength }: ShownArgument): Markup | string {
  if (oneOf.length > 0) {
    return html`<p class="limit">
      One of ${oneOf.map((value, place) => html`${place === 0 ? '' : ', '}<code>${value}</code>`)}
    </p>`;
  }
  if (pattern !== undefined) {
    return html`<p class="limit">Pattern <code>${pattern}</code></p>`;
  }
  return maxLength === undefined ? '' : html`<p class="limit">At most ${maxLength} characters</p>`;
}

function argumentsOf(tool: ShownTool): Markup {
  if (tool.arguments.length === 0) {
    return html`<p class="subtitle">Takes no arguments.</p>`;
  }
  const rows = tool.arguments.map(
    (argument) =>
      html`<tr>
        <td>${argument.name}${argument.required ? html`<span class="required">required</span>` : ''}</td>
        <td><code>${argument.type}</code></td>
        <td>${argument.description}${limitOf(argument)}</td>
      </tr>`,
  );
  return html`<div class="table">
    <table class="args">
      <thead>
        <tr>
          <th>Argument</th>
          <th>Type</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>`;
}

function toolOf(prefix: string, tool: ShownTool): Markup {
  const hints = tool.hints.map((hint) => html`<li>${hint}</li>`);
  return html`<article class="tool" id="${idOf(prefix, `tool-${tool.name}`)}" data-title="${tool.name}">
    <h3>${tool.name}</h3>
    <p class="subtitle">${tool.title}</p>
    <p>${tool.description}</p>
    <ul class="hints">
      ${hints}
    </ul>
    ${argumentsOf(tool)}
  </article>`;
}

function groupOf(prefix: string, group: ToolGroup): Markup {
  return html`<h3 class="group-name">${group.name}</h3>
    ${group.tools.map((tool) => toolOf(prefix, tool))}`;
}

function instructionsOf(connection: SurfaceConnection, version: string): Markup {
  return html`<section class="view" id="${idOf(connection.prefix, 'instructions')}" data-title="Instructions">
    <p class="eyebrow">At connect</p>
    <h2 class="title">Instructions</h2>
    <p class="lead">
      The text an agent receives once, when it connects to <code>${connection.path}</code>, in the answer to
      <code>initialize</code>. Shown verbatim, ${connection.instructions.length} characters.
    </p>
    <pre class="verbatim">${connection.instructions}</pre>
    <p class="note">
      On a real connection the text opens with one more sentence, which names the caller and the organization, such as
      “This connection acts as the key ci-bot in the org acme.” This page has no caller, so it leaves that sentence out.
      The server names itself Auto Runtime, version ${version}.
    </p>
  </section>`;
}

function toolsOf(connection: SurfaceConnection): Markup {
  return html`<section class="view" id="${idOf(connection.prefix, 'tools')}" data-title="Tools">
    <p class="eyebrow">Tools</p>
    <h2 class="title">${connection.toolCount} tools on <code>${connection.path}</code></h2>
    <p class="lead">
      The answer to <code>tools/list</code>: each tool with its title, its description and its arguments, as the agent
      reads them. A caller with fewer permissions is offered fewer tools.
    </p>
    ${connection.groups.map((group) => groupOf(connection.prefix, group))}
  </section>`;
}

function promptArgumentsOf(prompt: ShownPrompt): Markup | string {
  if (prompt.arguments.length === 0) {
    return '';
  }
  return html`<ul>
    ${prompt.arguments.map(
      (argument) =>
        html`<li><code>${argument.name}</code>${argument.required ? ' (required)' : ''}: ${argument.description}</li>`,
    )}
  </ul>`;
}

function promptOf(prefix: string, prompt: ShownPrompt): Markup {
  return html`<article class="prompt" id="${idOf(prefix, `prompt-${prompt.name}`)}" data-title="${prompt.name}">
    <h3>${prompt.name}</h3>
    <p class="subtitle">${prompt.title}</p>
    <p>${prompt.description}</p>
    ${promptArgumentsOf(prompt)}
    <details class="raw">
      <summary>What the client receives when it is picked</summary>
      ${prompt.texts.map((text) => html`<div class="md">${markdownOf(text)}</div>`)}
      ${prompt.attached.map((uri) => html`<p class="subtitle">Attached resource: <code>${uri}</code></p>`)}
    </details>
  </article>`;
}

function promptsOf(connection: SurfaceConnection): Markup {
  const { prefix, prompts, path } = connection;
  return html`<section class="view" id="${idOf(prefix, 'prompts')}" data-title="Prompts">
    <p class="eyebrow">Prompts</p>
    <h2 class="title">${prompts.length} prompts on <code>${path}</code></h2>
    <p class="lead">
      The answer to <code>prompts/list</code>: starting points a person picks in their client. A recipe is offered only
      where the connection lists every tool it calls. Placeholders in braces stand for the person’s words.
    </p>
    ${prompts.length === 0 ? html`<p>This connection offers no prompts.</p>` : ''}
    ${prompts.map((prompt) => promptOf(prefix, prompt))}
  </section>`;
}

function connectionOf(connection: SurfaceConnection, version: string): Markup {
  return html`<div class="connection" data-connection="${connection.key}">
    <h2 class="connection-name reading-only">${connection.label}, <code>${connection.path}</code></h2>
    ${instructionsOf(connection, version)} ${toolsOf(connection)} ${promptsOf(connection)}
  </div>`;
}

function guideOf(prefix: string, guide: Guide): Markup {
  return html`<section class="view" id="${idOf(prefix, `guide-${guide.name}`)}" data-title="${guide.name}">
    <p class="eyebrow">Guide · <code>get_guide({ guide: "${guide.name}" })</code></p>
    <p class="lead">${guide.description} The agent receives this as Markdown; this page renders it.</p>
    <div class="md">${markdownOf(guide.text)}</div>
    <details class="raw markdown">
      <summary>Raw Markdown</summary>
      <pre class="verbatim">${guide.text}</pre>
    </details>
  </section>`;
}

function shelfOf(shelf: SurfaceShelf, labels: ReadonlyMap<string, string>): Markup {
  const holders = shelf.connections.map((key) => labels.get(key)).join(', ');
  return html`<div class="shelf" data-connections="${shelf.connections.join(' ')}" data-label="Guide">
    <h2 class="connection-name reading-only">Guides of ${holders}</h2>
    ${shelf.guides.map((guide) => guideOf(shelf.prefix, guide))}
  </div>`;
}

function treeOf(connection: SurfaceConnection): Markup {
  const { prefix } = connection;
  const link = (part: string, words: string) => html`<li><a href="#${idOf(prefix, part)}">${words}</a></li>`;
  return html`<div class="tree" data-connection="${connection.key}">
    <p class="label reading-only">${connection.label}</p>
    <p class="label">At connect</p>
    <ul>
      ${link('instructions', 'Instructions')}
    </ul>
    <p class="label">Tools <span class="n">${connection.toolCount}</span></p>
    <ul>
      ${link('tools', 'Every tool')}
      ${connection.groups.map(
        (group) =>
          html`<li>
            <details>
              <summary>${group.name} <span class="n">${group.tools.length}</span></summary>
              <ul>
                ${group.tools.map((tool) => link(`tool-${tool.name}`, tool.name))}
              </ul>
            </details>
          </li>`,
      )}
    </ul>
    <p class="label">Guides, through get_guide</p>
    <ul>
      ${connection.guides.map((guide) => link(`guide-${guide.name}`, guide.name))}
    </ul>
    <p class="label">Prompts <span class="n">${connection.prompts.length}</span></p>
    <ul>
      ${link('prompts', 'Every prompt')}
      ${connection.prompts.map((prompt) => link(`prompt-${prompt.name}`, prompt.name))}
    </ul>
  </div>`;
}

function switchOf(connection: SurfaceConnection): Markup {
  return html`<li>
    <a
      href="#${idOf(connection.prefix, 'instructions')}"
      data-switch="${connection.key}"
      data-prefix="${connection.prefix}"
      data-label="${connection.label}"
      >${connection.label} <code>${connection.path}</code></a
    >
  </li>`;
}

export function debugPageOf(surface: AgentSurface, head: string): Markup {
  const { connections, shelves, serverInfo } = surface;
  const labels = new Map(connections.map(({ key, label }) => [key, label]));
  return html`<!doctype html>
    <html lang="en">
      <head>
        ${raw(head)}
      </head>
      <body>
        <div class="shell">
          <nav class="rail" aria-label="Contents">
            <div class="bar">
              <p class="name">${debugPageTitle}</p>
              <button type="button" class="search-open scripted-only" data-search>Search <kbd>⌘K</kbd></button>
            </div>
            <p class="sub">Everything this server gives an agent over MCP, for a caller with every permission.</p>
            <div class="bar compact scripted-only">
              <button type="button" class="contents-toggle" aria-expanded="false" data-contents>Contents</button>
              <select aria-label="Connection" data-connections>
                ${connections.map(
                  (connection) =>
                    html`<option value="${idOf(connection.prefix, 'instructions')}">${connection.label}</option>`,
                )}
              </select>
            </div>
            <p class="label switches">Connection</p>
            <ul class="switches">
              ${connections.map((connection) => switchOf(connection))}
            </ul>
            <div class="contents">${connections.map((connection) => treeOf(connection))}</div>
          </nav>
          <main>
            <div class="doc">
              ${connections.map((connection) => connectionOf(connection, serverInfo.version))}
              ${shelves.map((shelf) => shelfOf(shelf, labels))}
            </div>
          </main>
        </div>
        <dialog class="palette" id="palette" aria-label="Search">
          <input type="search" placeholder="Search tools, guides and prompts" aria-label="Search" />
          <ol></ol>
        </dialog>
      </body>
    </html>`;
}
