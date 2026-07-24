# action-require-labels

A GitHub Action that fails when a pull request is missing required labels — without using the GitHub API or tokens.

It is made for maintainers who want to enforce a labeling policy on pull requests before merge. Typical use cases:

- Requiring a change-type label (like `bugfix` or `new-feature`) so generated release notes and changelogs stay accurate.
- Requiring a triage or size label before a pull request can be reviewed.
- Blocking merges while labels like `do-not-merge` or `wip` are present (see [`require: none`](#failing-when-any-of-the-labels-exist)).

Add the check as a required status check on your branch to make the labels mandatory before merge.

## Why this action?

- **No token, no API calls** — labels are read straight from the workflow event payload, so the action runs with `permissions: {}`.
- **Zero dependencies** — the entire action is a single small script ([action.js](action.js)) you can audit in one read, with no third-party packages.
- **Composable** — match any of several labels in one step, combine steps to require [one label from each set](#requiring-one-label-from-each-of-multiple-sets), or [block labels](#failing-when-any-of-the-labels-exist) with `require: none`.

## How it works

The action reads the pull request labels from the event payload and, by default, succeeds when at least one of the configured labels is present. The [`require`](#require) input changes *how many* of the labels must be present — from "at least one" (the default) to "none", an exact count, or a comparison.

- It only works on `pull_request` events; it fails on any other event.
- It runs on Node 24, so the runner needs to support the `node24` action runtime.

## Inputs

### `labels`

**Required** Comma separated string of labels to look for.

By default the check passes when the pull request has **at least one** of the listed labels (OR matching), not all of them. For example, with `bugfix, breaking-change, new-feature`, a pull request labeled with any single one of those passes. Use [`require`](#require) to change how many must be present.

Labels are matched against the pull request labels exactly, including casing. Whitespace around each comma-separated entry is ignored. Supplying the same label more than once has no effect on matching, but logs a warning so the duplicates can be cleaned up.

### `require`

**Optional** How many of the [`labels`](#labels) must be present on the pull request. Defaults to `any`.

| Value | Meaning |
| --- | --- |
| `any` (default) | **At least one** of the labels must be present. |
| `none` | **None** of the labels may be present — the check fails if any are (see [blocking](#failing-when-any-of-the-labels-exist)). |
| `<N>` (e.g. `1`) | **Exactly** `N` of the labels must be present. `1` enforces exactly one. |
| `<=N` (e.g. `<=2`) | **At most** `N` of the labels may be present (zero is allowed). |
| `>=N` (e.g. `>=2`) | **At least** `N` of the labels must be present. |

The keywords are case-insensitive and surrounding whitespace is ignored. Numbers must be non-negative integers.

> [!NOTE]
> In YAML a value that starts with `>` is a block-scalar indicator, so `>=N` must be quoted: `require: '>=2'`. `<=N`, plain numbers, and the keywords need no quoting.

## Behavior

The result is communicated through the step's success or failure; the action has no outputs.

The step **passes** when the number of configured labels present on the pull request satisfies [`require`](#require) (by default, at least one).

The step **fails** when:

- Fewer configured labels are present than [`require`](#require) demands (for the default `any`, that means none are present — including when the pull request has no labels at all).
- More configured labels are present than [`require`](#require) allows (for example any are present when `require: none`).
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

### Requiring exactly one label

Use [`require: 1`](#require) to require **exactly one** of the listed labels — for example exactly one priority label.

<details>
<summary>More details and example</summary>

`require: 1` makes the step pass only when exactly one of the labels is present — it fails both when none are present and when two or more are.

```yaml
    ...
    steps:
      - name: Require exactly one priority label
        uses: ludeeus/action-require-labels@2.0.0
        with:
          labels: >-
              p1, p2, p3
          require: 1
```

</details>

### Failing when any of the labels exist

Use [`require: none`](#require) to fail when **any** of the listed labels are present — for example to block merging on `do-not-merge`, `wip` or `blocked`.

<details>
<summary>More details and example</summary>

With `require: none` the step fails as soon as one of the listed labels is present, and passes when none are (including when the pull request has no labels at all). No `continue-on-error` or follow-up step is needed.

```yaml
    ...
    steps:
      - name: Block on merge-blocking labels
        uses: ludeeus/action-require-labels@2.0.0
        with:
          labels: >-
              do-not-merge, wip, blocked
          require: none
```

</details>

## License

This project is licensed under the [MIT License](LICENSE).
