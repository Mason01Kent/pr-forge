import type { ExistingPrSummary } from './scm/index';

export function isDuplicatePrSubmitError(message: string): boolean {
    const lower = message.toLowerCase();
    return [
        'already exists',
        'already made',
        'another open merge request',
        'another open pull request',
        'duplicate pull request',
        'duplicate merge request',
        'existing pull request',
        'existing merge request',
    ].some(fragment => lower.includes(fragment));
}

export function buildPrSnapshotDocument(
    label: string,
    pr: Pick<ExistingPrSummary, 'number' | 'url' | 'title' | 'body' | 'draft'>,
    meta: { owner: string; repo: string; head: string; base: string }
): string {
    const title = (pr.title ?? '').trim() || '(untitled)';
    const body = (pr.body ?? '').trim() || '_No body provided._';
    const remoteDraft = pr.draft ? 'yes' : 'no';
    return [
        `# ${label}`,
        '',
        `- Number: #${pr.number}`,
        `- URL: ${pr.url}`,
        `- Repo: ${meta.owner}/${meta.repo}`,
        `- Branch: ${meta.head} \u2192 ${meta.base}`,
        `- Draft: ${remoteDraft}`,
        '',
        '## Title',
        title,
        '',
        '## Body',
        body,
    ].join('\n');
}
