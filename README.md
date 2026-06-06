# action-require-labels

This action privides a simple solution to require spesific labels on pull requests. Without the need to use the GitHub API and tokens.

## Inputs

### `labels`

**Required** Comma seperated string of labels to look for.

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
