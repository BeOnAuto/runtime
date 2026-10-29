# Contribute to the documentation

Runtime documentation lives in this public repository so a pull request can change behavior and its explanation together. The Auto website publishes these pages alongside its own guides and marketing content.

## Documentation types

Use [Diátaxis](https://diataxis.fr/) to keep learning, doing, looking up and understanding apart. A page's purpose decides what belongs in it.

| Purpose                                            | Sidebar group        | What the reader should get                                             |
| -------------------------------------------------- | -------------------- | ---------------------------------------------------------------------- |
| Getting started                                    | Get started          | Auto running and connected, in plain steps                             |
| [Tutorial](https://diataxis.fr/tutorials/)         | Tutorials            | One guided exercise with supplied inputs and results they can check    |
| [How-to guide](https://diataxis.fr/how-to-guides/) | Guides, Self-hosting | Steps to complete one task, assuming the reader knows the basics       |
| [Explanation](https://diataxis.fr/explanation/)    | Concepts             | A model of how the pieces fit and why the distinctions matter          |
| [Reference](https://diataxis.fr/reference/)        | Reference            | Precise formats, fields, limits and behavior, each findable on its own |

Some pages keep an older address for links from elsewhere: Terminology is listed under Reference but lives at `concepts/terminology`, and the configuration reference lives at `self-host/configuration`.

The newcomer pages (the quick start and the tutorials) are written for a business specialist using hosted Auto. Use plain words, explain a term in passing, say what the reader will see, let the agent do the technical work, and name playbooks and functions by plain names in quotes rather than ids.

In a tutorial, choose the example for the reader. State prerequisites, show what should happen after each meaningful action and include a check the reader can repeat. Say which output comes from a model and varies, and which the runtime returns every time. Do not invent screens, endpoints or model access to make instructions look complete.

A guide can offer the choices its task needs, such as which Apollo connection provides business data. A reference describes each option without turning into a walkthrough. A concept page explains; it links to the reference for limits, error kinds and fields instead of listing them.

## Writing style

- Write short sentences: one idea each, rarely more than 25 words. When a sentence collects conditions, turn them into a list.
- Put rules, limits, fields, settings and options in tables or bullets. Lead with the common case, then the exceptions.
- Give each fact one home and link to it from other pages. The home of capability status is [Functions](../concepts/functions.md#availability).
- Use ordinary words and examples grounded in the product. Keep API names exact and make no claim you have not checked against the code.
- Use [Playbook terminology](../concepts/terminology.md) for resources, capabilities and domain names. A reasoning function has a prompt; workflows coordinate functions; a run carries out a definition once.
- Use sentence-case headings, and no em dashes.

The runtime serves [Terminology](../concepts/terminology.md), every format reference and [Templates](../reference/template.md) to agents through `get_guide`, so an agent reads each of those pages alone. Keep each one complete on its own, or name the guide that holds what it leaves out, and keep each page under 64 KiB, the most a guide may hold.

## What belongs here

These public pages under `docs/` hold everything a user of the runtime needs:

- connecting an agent to hosted Auto;
- the concepts, the tutorials and the task guides;
- the self-hosting guides, from running the image to configuring and operating it;
- the format of each definition, and the MCP and HTTP references.

Account management, pricing and marketing pages belong in the website repository.

Implementation notes and contributor APIs stay in package READMEs and root contributor files; link to the user guide rather than copying it. Development setup for a checkout, transitional implementation guides and internals such as library function names belong in `docs/engineering/`. That folder stays beside the code and is left out of the public preview, search, navigation and the website import. Do not add it to `nav.json` or link to it through a public route; a GitHub link can point contributors to it.

Public pages describe what the runtime does today. Update the relevant public page when a change reaches users, and keep the repository-only notes accurate for the checkout.

## Preview and check

From a checkout with pnpm installed:

```sh
pnpm install
pnpm docs:dev
```

Open the `/docs/` URL printed by VitePress. The preview uses the default theme and does not require the private website repository, an Auto account or model credentials.

Before opening a pull request:

```sh
pnpm docs:check
pnpm check
```

The docs check validates navigation and builds every public Markdown page with dead-link detection. It also checks that engineering guides and decisions stay outside the published output. The CI documentation job runs for public pull requests without private credentials. Fix build failures in the source page; do not disable link checks.

Each successful Documentation workflow uploads a `runtime-docs-<commit>` artifact containing the built preview. Open the workflow run from the pull request's checks and download it from Artifacts. Artifacts remain available for 14 days. This does not deploy a public site and needs no private repository or deployment token.

To view the downloaded build, check out the matching pull request and run `pnpm install`. Extract the artifact contents into `docs/.vitepress/dist`, then run:

```sh
pnpm docs:preview
```

Open the printed `/docs/` URL. Serve the preview through VitePress rather than opening `index.html` directly, so its routes and assets resolve correctly.

## Add or change a page

Create Markdown under the relevant directory and add its route to `docs/nav.json`. The local setup page, detailed self-hosting guides and operator model settings retain their addresses for existing links, but stay out of navigation and search. The public self-hosting overview directs new deployments to contact Auto. Links in that file are relative to the documentation base, such as `/concepts/playbooks`; do not prefix them with `/docs`.

Use relative Markdown links inside pages, such as `../concepts/functions.md`. They work in the repository, the standalone preview and the composed website. Do not link to the website's own guides: the standalone preview does not have them, and its build fails on a dead link. Keep assets in `docs/assets/` and refer to them relatively. Do not place secrets or account information in public examples.

Describe the checkout's implemented behavior precisely. Mark a planned capability in a section of its own, and keep current API identifiers in executable examples. Inspect `structuredContent` when consuming MCP results; the first text block is a human-readable summary, not a JSON envelope.

## Publication contract

The Auto website imports public Markdown, `assets/` and `nav.json` from a pinned runtime commit. Its own documentation index can replace this preview's `index.md`. The import excludes `engineering/`, `.vitepress`, generated output and tooling.

The website combines both sources in one build, with a shared sidebar and search. Imported pages link back to the corresponding public file through Edit this page. They are generated build inputs in the website; contributors edit the original here.

Updating the website's source pin publishes approved documentation changes. Release documentation should match the runtime release; documentation-only corrections can update the pin without a new runtime release. Source links identify the imported revision.

The standalone preview is for review, not a separate production documentation website. See the repository's [contribution guidelines](https://github.com/BeOnAuto/runtime/blob/main/CONTRIBUTING.md) and [security reporting policy](https://github.com/BeOnAuto/runtime/blob/main/SECURITY.md).
