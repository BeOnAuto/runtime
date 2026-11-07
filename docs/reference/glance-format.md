---
description: "The glance block of a workflow's page: what the workflow says about itself in a fixed shape, shown on the playbook's Overview in Auto Studio."
---

<div v-pre>

# Glance format

A workflow's page may hold `glance`, beside `data`, `result` and `runs`: what the workflow says about itself in a fixed shape, which Auto Studio shows on the playbook's Overview, in the counts on the playbook's tile on the home, and on the card a shared link to it shows; the workflow's own page shows its result instead. It is the one place a person looks to learn whether anything is waiting on them and what the workflow has done, so it is structured, lean and never padded. `get_definition` of the workflow carries it rendered, as `page.glance`.

`glance` is a mapping, not a block scalar. Each string in it, however deep, is a Liquid template, checked when the page is saved as `result` and `runs` are, with its line ([Page format](page-format.md#reading-values)); numbers, `true`, `false` and `null` are taken as written. It reads these variables and nothing else:

| Variable          | Value                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `views.<name>`    | Each view `data.views` names, as `runs` reads it; `null` while the views are being built      |
| `output`          | The output of the workflow's latest run that ended; `null` before one has, or where it failed |
| `run.status`      | How that run ended: `succeeded`, `rejected` or `failed`; `run` is `null` before one has ended |
| `run.started`     | When that run started, in ISO 8601, in UTC, where it succeeded                                |
| `run.ended`       | When that run ended, in ISO 8601, in UTC, where it succeeded                                  |
| `run.version`     | The version of the workflow that run used, where it succeeded                                 |
| `subject`         | The workflow, as `result` reads it                                                            |
| `today` and `now` | The date and the time of the read, as `result` reads them                                     |

A string that is a single output and nothing else, such as `'{{ views.done.values | size }}'`, renders as the JSON value its text reads as, so a count stays a number and `'{{ views.activity | json }}'` stays a list; any other string renders as its text, trimmed. Where any template of the glance stops, `get_definition` carries no `page.glance`. A glance takes at most 16,384 bytes as JSON, and a function's page and the playbook's have none.

Read the glance from the views where you can, so a check that changes nothing does not reset it to zero. Its fields:

- `headline`, required: one or two short sentences, 110 characters at most, about the world now, never about the run. `2 experiments in Executing; 3 human tasks are open across them.`, not `Run completed` or `No changes this time`.
- `visual`, required: exactly one of four shapes, each fed from `views`:
  - `{ kind: figures, items: [{ name, value, limit }] }`: two or three standing numbers, each `limit` optional. Names in sentence case, 24 characters at most. A `limit` shows as `0 / 2`.
  - `{ kind: bars, items: [{ name, value, limit }], aside: { name, value } }`: two to four named counts drawn as bars, each `limit` and the side figure `aside` optional.
  - `{ kind: progress, name, value, target }`: one count against a target.
  - `{ kind: trend, name, days, points: [{ at, value }], aside: { name, value } }`: one daily series over the last `days`, 14 or 30, from a view such as `views.activity`, its `aside` optional.

  Show no percentage unless its denominator is in the glance.

- `outstanding`, required and possibly empty: up to three items a person must act on, each `{ kind, title, ref, who, action: { label, href } }`, its `kind` one of `decision`, `task` and `blocker`. List only what a person must do, never a status. `title` names the person's move for a decision or a task, `Choose ideas to Accept` or `Publish the landing page variant`, and the prerequisite for a blocker, `Authorize the PostHog website connection`. `ref` is the external identifier where there is one, such as `MAR-52`, and `who` the person's name where it is known; both are optional. `action` is required on every item and is the one place to go and do it: an external address where the work lives outside Auto, such as the issue in Linear, or a route of Auto Studio's where it is inside Auto, such as `/connections` or `/connections/<provider>`. `label` is a verb or `Open <ref>`, three words at most. Write each `title` so it makes sense without the workflow's name, since the playbook sums them. Auto Studio heads the list Tasks, and shows an empty list as `No tasks.`

Leave out a state, which Auto Studio works out itself: a blocker in `outstanding`, or a latest run that failed or was rejected, needs attention; any other item requires input; a run in progress is running; otherwise the workflow is idle. Where its latest run failed or was rejected and no blocker says so, Auto Studio lists a blocker of its own first, saying what went wrong, so leave a failed run out of `outstanding`. Leave out too timestamps, the schedule, run counts, run statuses, costs, a next-step sentence, which the outstanding items are, the workflow's description, emoji, exclamation marks, and any sentence that restates another field. A field the glance does not name is ignored, an item without `action.href` is left out, and a headline is cut at 110 characters.

A verification fixture, a preview or a synthetic run must not change the glance: where `output` is a test's or a preview's, leave every field read from `views` as it is and add no outstanding item. A preview's sample output never reaches the glance, which only a recorded run's output does.

This glance of a workflow that coordinates approved experiments reads its counts from its views:

<!-- prettier-ignore -->
```yaml
page:
  glance:
    headline: '{{ views.stages.values[1].value }} experiments in Executing; {{ views.tasks.values | size }} human tasks are open across them.'
    visual:
      kind: bars
      items:
        - { name: Ready, value: '{{ views.stages.values[0].value }}', limit: 2 }
        - { name: Executing, value: '{{ views.stages.values[1].value }}', limit: 2 }
        - { name: Measuring, value: '{{ views.stages.values[2].value }}', limit: 3 }
      aside: { name: Human tasks open, value: '{{ views.tasks.values | size }}' }
    outstanding:
      - kind: task
        title: Publish the landing page variant
        ref: MAR-52
        who: Kit
        action: { label: Open MAR-52, href: 'https://linear.app/acme/issue/MAR-52' }
```

When no experiment is in Executing, the same glance says `No approved experiment is in Executing.` over `figures` of Executing `0 / 2`, Human tasks waiting `0` and Advanced to Measuring `0`, with an empty `outstanding`, which shows as idle. A workflow that waits on a connection says so as blockers, each with the route that resolves it:

<!-- prettier-ignore -->
```yaml
page:
  glance:
    headline: Website measurement is blocked until the PostHog website connection is authorized.
    visual: { kind: trend, name: Lessons confirmed, days: 30, points: '{{ views.lessons.lines[0].points | json }}' }
    outstanding:
      - kind: blocker
        title: Authorize the PostHog website connection
        action: { label: Authorize, href: /connections/posthog-website }
```

</div>
