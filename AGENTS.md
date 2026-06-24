# PR Forge Agent Instructions

## Release Workflow

- When shipping a change, update the local repository and the published release together.
- Rebuild the extension locally before publishing.
- Generate the VSIX artifact in the repo root and keep it in version control as `pr-forge-<version>.vsix`.
- Update the README so GitHub-facing instructions and Marketplace-facing install text stay current.
- Update the GitHub repository links and release references whenever the version changes.
- Publish the matching Marketplace release after the local artifact is generated.
- Push the GitHub commit for the source change and release metadata after publishing.

## Documentation Rules

- Keep README install examples aligned with the current versioned VSIX filename.
- Keep Marketplace and GitHub links accurate in badges, repository metadata, and release references.
- If a release adds or removes workflow behavior, update the README in the same change.

