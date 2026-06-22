# Default PR Review Rules

## General priorities
- **security**: Check for exposed secrets, injection risks, auth bypasses.
- **tests**: Verify new code has adequate test coverage.
- **configuration**: Check config defaults, environment-specific settings.
- **data integrity**: Validate data migrations, schema changes, serialization.
- **deployment risk**: Assess breaking changes, rollback safety, backwards compatibility.

## Review checklist
1. Does the diff include any hardcoded secrets or keys?
2. Are new dependencies justified and pinned?
3. Do database changes include rollback scripts?
4. Is error handling appropriate for the domain?
5. Are there obvious performance concerns?
6. Does the PR description match the actual changes?
