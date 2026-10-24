# Run a workflow on a schedule

A workflow can start on its own: at set times or every so often, in UTC, or whenever an event of a given type is published to the playbook. Read the workflow guide with get_guide before you write one.

1. Ask the person which workflow to run and when, such as every weekday at 9:00 their time, or whenever the month's books are closed. Find the workflow with list_definitions, `type` workflow, or write one in the format of the workflow guide.
2. Give the workflow a `schedule` as the workflow guide says, with one trigger or up to three, each kept on its own: `cron` with five fields, minute, hour, day of month, month and day of week, in UTC; `every` with a duration of at least a minute; and `on` with the type of the events that start it. A run its schedule starts runs as the playbook itself, with its due time, or a list of the event, as its input, and its history says which trigger started it.
3. Show the person the document, and save it with update_definition, or with create_definition for a new workflow, once they agree.
4. Tell the person when it runs next, in their own time, and that every run is kept in the playbook's history.
5. To see how its runs went, call list_runs with `type` workflow and the workflow's `name`, and get_run for one run.
