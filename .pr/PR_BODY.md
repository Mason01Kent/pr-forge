## Summary

This PR upgrades the PR Forge configuration schema from v7 to v8, adding support for `templateFiles` and improving metadata defaults handling. It also includes several test improvements and fixes for the SCM metadata automation layer.

## Why this matters

The schema upgrade enables users to specify custom PR/MR template files that get injected into the generation prompt, making AI-generated PR bodies more consistent with project conventions. The metadata defaults fix ensures that fields like `includeCommitSummaries`, `includeFileWalkthrough`, and `runTestsOnGenerate` are properly initialized when upgrading from older schema versions, preventing silent configuration gaps.

## Changes

- **Schema upgrade (v7 → v8)**: Added `templateFiles` field (defaults to empty array) and improved upgrade path for metadata defaults
- **Config migration**: Ensures `includeCommitSummaries`, `includeFileWalkthrough`, and `reReviewOnPush` are set to `false` when upgrading from v5 configs
- **Fresh config defaults**: Sets `schemaVersion` to 8 and `templateFiles` to `[]` on new configs
- **Preservation**: Existing fields are preserved during upgrade; explicit `runTestsOnGenerate: false` on v1 configs is not overwritten
- **SCM metadata automation**: Expanded test coverage for GitHub and GitLab review threads, labels, assignees, reviewers, and milestone operations
- **Test infrastructure**: Added tests for `parseGitHubRemote`, `getModelLimits`, `listModels`, `renderMarkdown`, `batchFileDiffs`, `titleFromBranch`, `parseRightSideLines`, `parseDiffAnchors`, `mapFindingsToComments`, `buildCommentBody`, `parseFindingsJson`, `annotateDiff`, `findingsToFallbackComment`, `parseRemote`, `GitLabScmProvider`, `submitFlow helpers`, `telemetry helpers`, and `templateDiscovery`

## Tests / verification

All 100 tests pass (183ms). Key test areas:
- Schema upgrade paths (v1 → v8, v5 → v8, v7 → v8)
- Fresh config defaults
- Field preservation during upgrades
- SCM provider operations (GitHub and GitLab)
- Template discovery and loading
- Remote URL parsing (HTTPS, SSH, enterprise, self-managed)
- Model limits and listing
- Diff batching and annotation
- Review comment mapping and fallback rendering

## Review focus

1. **Schema migration logic**: Verify that the v7 → v8 upgrade correctly handles all edge cases (empty configs, partial configs, explicit false values)
2. **Metadata defaults**: Confirm that `includeCommitSummaries`, `includeFileWalkthrough`, and `reReviewOnPush` are properly initialized to `false` when upgrading from v5
3. **Template file handling**: Ensure `templateFiles` defaults to empty array and doesn't break existing configs
4. **SCM provider tests**: Verify that the expanded test coverage for GitHub and GitLab operations is correct and doesn't introduce regressions

## Risks / follow-ups

- **Security**: No new API endpoints or credential handling changes; template files are read from the repository and injected into prompts (same pattern as existing `reviewRulesFiles`)
- **Tests**: All existing tests pass; new tests cover the upgrade paths and edge cases
- **Configuration**: Users upgrading from v5 will see `includeCommitSummaries`, `includeFileWalkthrough`, and `reReviewOnPush` default to `false` (previously undefined). This is intentional to prevent unexpected token spend
- **Data integrity**: Schema upgrade preserves all existing fields; no data loss expected
- **Deployment risk**: Schema change is backward-compatible; old configs will be upgraded on first use
- **Follow-up**: Consider adding migration documentation for users with custom v5 configs; monitor for any issues with template file discovery on Windows paths