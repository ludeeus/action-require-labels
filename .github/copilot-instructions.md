# action-require-labels

A GitHub Action that fails a workflow run when a pull request is missing
required labels. It reads labels directly from the workflow event payload —
no GitHub API calls, no token — so it runs under `permissions: {}`.

## Repository layout

- `action.yml` — action manifest (`runs.using: node24`, `main: action.js`)
- `action.js` — the entire implementation (CommonJS, exports `runAction`)
- `action.test.js` — unit tests using the built-in `node:test` runner
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
- **Escape untrusted output.** Any label-derived (user-controlled) string that
  is printed as part of a workflow command (`::error::`, `::warning::`) must go
  through `escapeData()` to prevent workflow-command injection.
- **Report failure via exit code, with the `ActionError` convention**: raise
  intentional failures (invalid configuration or input) as `ActionError`
  instances inside `runAction()` — the `ActionError` class is defined in
  `action.js` and exported alongside `runAction`. The entrypoint catches
  everything and sets `process.exitCode = 1`; the action has no outputs. For an
  `ActionError` it prints the escaped message via `::error::${escapeData(err.message)}`;
  for any other (unexpected) error it deliberately prints a generic
  `::error::Unknown error`, withholding the message rather than leaking internal
  detail.
- **Node 24 / CommonJS.** Match the declared runtime in `action.yml`; use
  `require()`, not ESM imports.
- **Keep comments in code to a minimum.** Self-explanatory code carries no
  comment — do not restate what a name, type, or control-flow structure already
  makes clear. Reserve comments for rationale the code genuinely cannot convey,
  such as a reference to an external specification. If code needs a comment to
  be understood, prefer clarifying the code (names, extracted helpers) over
  adding the comment.

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
