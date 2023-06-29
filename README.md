# action-require-labels

This action privides a simple solution to require spesific labels on pull requests. Without the need to use the GitHub API and tokens.

## Inputs

### `labels`

**Required** Comma seperated string of labels to look for.

## Example usage

```yaml
name: "Check Pull Request labels"

on:
  pull_request:
    types:
      - syncronize
      - labeled
      - unlabeled
    branches:
      - main

permissions: {}

jobs:
  check_labels:
    name: "Check Pull Request labels"
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v3

      - name: Check the labels
        uses: ludeeus/action-require-labels@1.0.0
        with:
        labels: >-
            bugfix, breaking-change, new-feature
```
