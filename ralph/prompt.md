# Ralph iteration — MSW Global

You are ONE iteration of the ralph loop. Fresh context each run; the durable
state is git history + `ralph/prd.json` + `ralph/progress.txt`.

Do exactly this, then stop:

1. Read `REQUIREMENTS.md`, `ralph/prd.json`, and `ralph/progress.txt`.
2. Pick the **highest-priority** story whose `status` is not `"pass"`.
3. Implement **only that story**, to its `accept` criteria. Minimal diff, match
   surrounding style, no drive-by refactors. Rebuild `@nexus/shared` if you edit it.
4. Validate: run the `validate` command from `prd.json`; fix until green.
5. Commit: `git commit -am "ralph <id>: <title>"` (branch `vercel-ready`).
6. Set that story's `status` to `"pass"` in `ralph/prd.json`.
7. Append 2–4 factual lines to `ralph/progress.txt` (what changed, files, gotchas).
8. **Stop.** Do not start another story.

If a story turns out to be already satisfied, verify against `accept`, mark it
`"pass"`, note why in progress.txt, and stop.
