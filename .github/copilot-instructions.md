# action-require-labels

A GitHub Action that fails a workflow run when a pull request is missing
required labels. It reads labels directly from the workflow event payload —
no GitHub API calls, no token — so it runs under `permissions: {}`.

## Repository layout

- `action.yml` — action manifest (`runs.using: node24`, `main: action.js`)
- `action.js` — the entire implementation (CommonJS, exports `runAction` and `main`)
- `action.test.js` — unit tests using the built-in `node:test` runner
- `action.test.js.snapshot` — committed snapshots of the generated step summaries
- `.github/workflows/unittest.yaml` — runs `node --test` on PRs/pushes to `main`
- `.github/workflows/test.yaml` — integration self-test that runs the local
  action (`uses: ./`) against this repo's own PR labels
- `.github/release.yml` — release-notes categories, driven by PR labels

## Design constraints (do not break these)

- **Zero third-party dependencies.** Only Node.js built-ins. No `package.json`,
  no `node_modules`, no build/bundle step — the action ships raw `action.js`.
  Being auditable in a single read is a stated feature; do not add
  `@actions/core`, `@actions/github`, or any other package.
- **No GitHub API or token usage.** All data comes from
  `process.env.GITHUB_EVENT_PATH` and `INPUT_*` environment variables.
  Everything must keep working under `permissions: {}`.
- **Escape label-derived output.** Any label-derived string printed as part of
  a workflow command (`::error::`, `::warning::`) must go through `escapeData()`
  so it stays on a single log line. Escape once, at the point the workflow
  command is written — never pre-escape a string that the entrypoint will escape
  again. Any label-derived string written to the optional step summary (a
  markdown file, not a workflow command) goes through `escapeMarkdown()` instead,
  so it stays inside a single, unbroken table cell.
- **Separate the verdict from the side effects.** `runAction()` validates the
  configuration (via `resolveConfiguration()`) and evaluates the labels, then
  **returns** a result object whose `failureMessage` is `null` on success or the
  failure text when the check fails. It performs no file writes and does not
  throw for a failed check. The root `main()` owns every side effect: it writes
  the step summary, prints the `::error::` annotation, and sets
  `process.exitCode`.
- **Report failure via exit code, with the `ActionError` convention**: raise
  intentional failures for **invalid configuration or input** as `ActionError`
  instances (in `resolveConfiguration()` and the `resolve*` helpers it calls) —
  the `ActionError` class is defined in `action.js` and exported alongside
  `runAction` and `main`. `runAction()` itself never throws for a failed check;
  it returns the `failureMessage`, and `main()` raises that as an `ActionError`
  once the summary has been written, so every failure is reported through a
  single path. That path is `main()`'s catch: it sets `process.exitCode = 1` (the
  action has no outputs) and, for an `ActionError`, prints the escaped message via
  `::error::${escapeData(err.message)}`; for any other (unexpected) error it
  deliberately prints a generic `::error::Unknown error`, withholding the message
  rather than leaking internal detail.
- **Node 24 / CommonJS.** Match the declared runtime in `action.yml`; use
  `require()`, not ESM imports.
- **Comments are the exception, not the default.** Do not comment what names,
  types, and control flow already make clear — delete such comments instead of
  writing them, and fix unclear code by renaming or extracting a helper, not by
  annotating it. A comment is justified only to capture what the code cannot: a
  reference to an external specification, or the non-obvious *why* behind a
  deliberate choice. Never comment the *what* or the *how*. When in doubt, leave
  it out. This does not license removing required annotations — e.g. the
  `# vX.Y.Z` tag on a pinned action SHA (see Workflow / CI conventions) or the
  workflow-command reference in `escapeData()`.

## Code style

- **Prefer returning values over mutating `let`.** When a value is computed
  through branching, extract the logic into a small helper that returns the
  resolved value and assign it to a `const`, rather than seeding a `let` and
  reassigning it.
- **Use descriptive names for constants and functions.** A name should say what
  the value or function represents (e.g. `resolveMaximumMatchingLabelsCount`,
  not `resolveMaximumMatchingLabels`).
- **Define helpers as `const` arrow functions**, e.g.
  `const resolveMaximumMatchingLabelsCount = (defaultValue) => { ... }`.

## Testing

Run the full test suite with the built-in Node test runner (no npm install):

    node --test

This is exactly what CI runs. Tests mock `node:fs` and set env vars via the
`stubEvent()` helper in `action.test.js`; mocks and env are restored in
`afterEach`. New behavior in `action.js` needs matching coverage in
`action.test.js`, including failure branches.

The generated step summaries are covered by snapshots in
`action.test.js.snapshot`, stored verbatim so the file reads as the rendered
markdown. It is committed and CI verifies against it. After an intentional change
to the summary output, regenerate it and read the diff before committing:

    node --test --test-update-snapshots

Never regenerate to make a red test pass without checking the diff — a few
summary tests keep explicit assertions next to the snapshot (no raw `|` in a
cell, no row broken across lines) precisely so an escaping regression cannot be
absorbed by a blind refresh.

## Workflow / CI conventions

- Workflows declare `permissions: {}` at the top level.
- Third-party actions are pinned to a full commit SHA (with a version
  comment), and checkouts use `persist-credentials: false`.
- `test.yaml` dog-foods the action: it must keep passing against the label
  set used by this repo's PRs.

## Pull requests and releases

- Every PR must carry exactly one change-type label (enforced by the action
  itself in `test.yaml`): `bugfix`, `breaking-change`, `new-feature`,
  `dependencies`, `ci`, `documentation`, `internal`, or `refactor`.
- A subset of these labels is used to categorize auto-generated release notes (`.github/release.yml`).
- Releases are SemVer git tags (e.g. `2.0.0`), referenced in the README as
  `ludeeus/action-require-labels@<version>`.

## Documentation

- `README.md` is the user-facing documentation. Update it when inputs or
  behavior change, keeping the documented examples (at-least-one,
  exactly-one via `maximum_matching_labels: 1`, AND via repeated steps,
  inverted/blocking via `continue-on-error`) accurate.
- Keep this file (`.github/copilot-instructions.md`) and the README
  up-to-date whenever the action's behavior, inputs, or conventions change.
