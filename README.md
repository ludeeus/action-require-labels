# action-require-labels

This action provides a simple solution to require specific labels on pull requests. Without the need to use the GitHub API and tokens.

## Inputs

### `labels`

**Required** Comma separated string of labels to look for.

The check passes when the pull request has **at least one** of the listed labels (OR matching), not all of them. For example, with `bugfix, breaking-change, new-feature`, a pull request labeled with any single one of those passes. It fails only when none of the listed labels are present.

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
    runs-on: ubuntu-latest
    steps:
      - name: Check the labels
        uses: ludeeus/action-require-labels@2.0.0
        with:
          labels: >-
              bugfix, breaking-change, new-feature
```

## Advanced usage

<details>
<summary>Requiring one of multiple sets of labels</summary>

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

<details>
<summary>Failing when any of the labels exist (inverted)</summary>

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
