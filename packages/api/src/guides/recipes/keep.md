# Keep something for later

What the person wants kept is the output of a run: each run that succeeds keeps its output in the playbook's history, and a lookup function reads it back from the runs of that definition. Read the lookup-function guide with get_guide before you write one; its section Reading the playbook's own runs sets out `runs`.

1. Ask the person what should be kept, in their words, and what later work needs it, such as who approves a budget, or what each round of the drivers reported.
2. Find the function whose output already holds it with list_definitions. Where none does, write one whose output is that thing, such as a computation function whose program answers its input as it is, in the format of its type's guide; show it to the person, and save it with create_definition once they agree.
3. Run it with run_definition, with what is to be kept as its input. A run that does not succeed keeps nothing to read back.
4. Write a lookup function with `runs` in place of `call`: `type` and `name` naming that function, `words` the words every output it answers holds, and `since` the earliest start of a run it answers. `words` and `since` alone are templates, which may read the lookup's input, `today` and `now`. Show the person the document, and save it with create_definition, `type` lookup, once they agree.
5. Run the lookup with run_definition and tell the person what it read back: the outputs of the runs that succeeded, newest first, with `more` true where older runs are left unread, which a later `since` or other `words` narrows.
6. To correct what was kept, run the function again with the new text: its run is the newest, so the lookup answers it first. Tell the person that every run stays in the playbook's history, and that what needs what was kept, a reasoning function or a workflow's step, is given the lookup's answer.
