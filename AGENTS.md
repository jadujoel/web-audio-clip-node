

When asked to create plan, save it to tasks/todo/dd-clip-{task-number}-{task-name}.md. Save latest task number in tasks/latest.md.

when done with a task, move to done.

When done with a task make sure there are no type or lint errors.

Whenever updating something related to infra its best you the agent run the terraform apply and also smoke tests in ci to make sure you got it right.

whenever fixing something, add an end to end test to cover the fixed issue and prevent regressions.

Since we dont have any users yet we don't need to think about backwards compatibility right now.

Whenever you are doing something and find pre-existing errors. Fix them as well.

Whenever working on the studio gui and you add code you also add unit tests and component tests if relevant.

When adding new Studio components, add them to `workspaces/studio/gui/src/ComponentCatalog.tsx` and run `bun run screenshot:catalog` from the gui directory to regenerate catalog PNGs.

When adding controller components, add them to `workspaces/controller/gui/src/ComponentCatalog.tsx` and run `bun run screenshot:catalog` from the controller/gui directory to regenerate catalog PNGs.

When asked to make sure ci passes, you push to github and follow the workflow run in the Actions tab. If it fails, you check the logs, fix the issue, and push again.

When asked to research something, save your findings in a markdown file in the research/ directory.

When asked to critique something, write your critique next to the file asked to critique in a file named {filename}.critique.md

When asked to "test everything", you should run linting, type checking, unit tests, component tests, end-to-end tests, smoke tests. Make sure latest infra is deployed, as well as commit and push to ci and follow the workflow run to make sure it passes.

When asked to create a thorough plan
- do the research step and discover the gold standard for how to do the thing you're planning
- do the planning step based on the research
- critique the plan
- create a final plan based on the critiques of the plan, then remove drafts to avoid confusion

When asked to implement todo
- Read through the issues in todo
- Update issues if they have conflicting or missing information
- Create a step by step implementation plan, which issue should be implemented first, which later, and why
- Implement the issues in the order determined by the plan

When asked to fix lint issues, do not be lazy and suppress but instead fix the issues.

Avoid mocking, instead refactor to use dependency injection.

when done with a task, check types lint and tests before moving to done.
