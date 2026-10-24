# Create your first playbook

A first playbook holds one reasoning function that the person can run and see the answer of. Read the reasoning-function guide with get_guide before you write the function.

1. Call list_playbooks to see the playbooks of the org, and list_models where this connection has it to see the models this server can call. When it lists none and says in `provider_setup` how the person adds a model provider, help them do that first.
2. Ask the person what the playbook is for, in their own words, and what its first function should do, such as checking a campaign brief for an audience, a budget and a measurable goal. When more than one model is offered, ask which to use; a model whose id ends in `*` stands for many and is not a model to run.
3. Create the playbook with create_playbook, with an id of lowercase letters, digits and hyphens and the person's words on what it is for, or use the playbook they name when list_playbooks shows it.
4. Write the reasoning function in the format of the reasoning-function guide: its model, a description, an input schema with the fields the person will give, and a prompt. When it should use a tool server's tools, follow the give-tools recipe: to learn what a tool answers, call it with execute, and never make a function to look. Show the person the whole document and ask whether to save it.
5. Once they agree, save it with create_definition, `type` reasoning. A name that is taken is refused; choose another with the person rather than changing the function that has it.
6. Ask for an input, run the function with run_definition, and tell the person what it answered, in their words.
7. Tell the person what they can do next: run it again on another input, change it, give it tools with the give-tools recipe, make the playbook remember its answers with the remember recipe, or run it on a schedule with the schedule recipe.
