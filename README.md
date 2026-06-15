# action-require-labels

A GitHub Action that fails when a pull request is missing required labels — without using the GitHub API or tokens.

It is made for maintainers who want to enforce a labeling policy on pull requests before merge. Typical use cases:

- Requiring a change-type label (like `bugfix` or `new-feature`) so generated release notes and changelogs stay accurate.
- Requiring a triage or size label before a pull request can be reviewed.
- Blocking merges while labels like `do-not-merge` or `wip` are present (see [inverted usage](#failing-when-any-of-the-labels-exist-inverted)).

Add the check as a required status check on your branch to make the labels mandatory before merge.

## Why this action?

- **No token, no API calls** — labels are read straight from the workflow event payload, so the action runs with `permissions: {}`.
- **Zero dependencies** — the entire action is a single small script ([action.js](action.js)) you can audit in one read, with no third-party packages.
- **Composable** — match any of several labels in one step, combine steps to require [one label from each set](#requiring-one-label-from-each-of-multiple-sets), or [invert the check](#failing-when-any-of-the-labels-exist-inverted) to block labels.

## How it works

The action reads the pull request labels from the event payload and succeeds when at least one of the configured labels is present.

- It only works on `pull_request` events; it fails on any other event.
- It runs on Node 24, so the runner needs to support the `node24` action runtime.

## Inputs

### `labels`

**Required** Comma separated string of labels to look for.

The check passes when the pull request has **at least one** of the listed labels (OR matching), not all of them. For example, with `bugfix, breaking-change, new-feature`, a pull request labeled with any single one of those passes. It fails only when none of the listed labels are present.

Labels are matched against the pull request labels exactly, including casing. Whitespace around each comma-separated entry is ignored.

## Outputs

### `matching_label_count`

The number of required labels found on the pull request.

The output is set on both the passing path and the no-match failing path (where it is `0`), so it is available to later steps even when the step fails — use `continue-on-error: true` to read it after a failure. It is not set when the action fails before evaluating the labels (for example on a non-`pull_request` event or when the pull request has no labels at all).

## Behavior

The primary result is communicated through the step's success or failure; additional details are exposed via the step's [outputs](#outputs).

The step **passes** when the pull request has at least one of the configured labels.

The step **fails** when:

- The pull request has none of the configured labels.
- The pull request has no labels at all.
- The workflow was not triggered by a `pull_request` event.

## Example usage

```yaml
name: "Check Pull Request labels"

on:
  pull_request:
    branches:
      - main
    types:
      - labeled
      - opened
      - synchronize
      - unlabeled

permissions: {}

jobs:
  check_labels:
    name: "Check Pull Request labels"
    runs-on: ubuntu-slim
    steps:
      - name: Check the labels
        uses: ludeeus/action-require-labels@2.0.0
        with:
          labels: >-
              bugfix, breaking-change, new-feature
```

The `labeled` and `unlabeled` trigger types make the check re-run whenever labels are added or removed, so the status always reflects the current labels.

## Advanced usage

### Requiring one label from each of multiple sets

Add the action multiple times to require one label from *each* set (combining the sets with AND).

<details>
<summary>More details and example</summary>

Because each invocation requires **at least one** of its labels (OR matching), you can add the action multiple times to require one label from *each* set. Every step must pass for the job to succeed, so this effectively combines the sets with AND.

The example below requires the pull request to have at least one **type** label (`bugfix`, `breaking-change` or `new-feature`) **and** at least one **size** label (`small`, `medium` or `large`).

```yaml
    ...
    steps:
      - name: Check the type label
        uses: ludeeus/action-require-labels@2.0.0
        with:
          labels: >-
              bugfix, breaking-change, new-feature

      - name: Check the size label
        uses: ludeeus/action-require-labels@2.0.0
        with:
          labels: >-
              small, medium, large
```

</details>

### Failing when any of the labels exist (inverted)

Invert the check to fail when **any** of the listed labels are present (for example to block merging on `do-not-merge`, `wip` or `blocked`).

<details>
<summary>More details and example</summary>

The action passes when the pull request has **at least one** of the listed labels. To invert this — failing when **any** of the labels are present (for example to block merging on `do-not-merge`, `wip` or `blocked`) — run the action with `continue-on-error: true` to capture its outcome, then fail a follow-up step when that outcome was `success`.

When the pull request has no labels at all, the action exits with a failure, so the inverted check correctly passes (no blocking label is present).

```yaml
    ...
    steps:
      - name: Check for blocking labels
        id: blocking
        continue-on-error: true
        uses: ludeeus/action-require-labels@2.0.0
        with:
          labels: >-
              do-not-merge, wip, blocked

      - name: Fail if a blocking label is present
        if: steps.blocking.outcome == 'success'
        run: |
          echo "::error::A blocking label is present on the pull request."
          exit 1
```

</details>

## License

This project is licensed under the [MIT License](LICENSE).
