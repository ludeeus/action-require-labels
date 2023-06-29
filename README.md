# action-require-labels

This action privides a simple solution to require spesific labels on pull requests. Without the need to use the GitHub API and tokens.

## Inputs

### `labels`

**Required** Comma seperated string of labels to look for.

## Example usage

```yaml
uses: ludeeus/action-require-labels@main
with:
 labels: >-
    bugfix, breaking-change, new-feature
```
