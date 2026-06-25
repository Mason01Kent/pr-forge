import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { discoverRepositoryTemplateFiles, loadTemplateGuidance } from '../templateDiscovery';

function makeTempRepo(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-forge-templates-'));
    fs.mkdirSync(path.join(root, '.github', 'PULL_REQUEST_TEMPLATE'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs', 'PULL_REQUEST_TEMPLATE'), { recursive: true });
    fs.mkdirSync(path.join(root, '.gitlab', 'merge_request_templates'), { recursive: true });
    fs.writeFileSync(path.join(root, '.github', 'PULL_REQUEST_TEMPLATE', 'feature.md'), '# GitHub template\n- [ ] tests', 'utf-8');
    fs.writeFileSync(path.join(root, 'docs', 'PULL_REQUEST_TEMPLATE', 'bugfix.md'), '# Docs template', 'utf-8');
    fs.writeFileSync(path.join(root, '.gitlab', 'merge_request_templates', 'default.md'), '# GitLab template', 'utf-8');
    return root;
}

describe('templateDiscovery', () => {
    it('discovers repository PR and MR template files', () => {
        const root = makeTempRepo();
        const files = discoverRepositoryTemplateFiles(root).sort();
        assert.deepStrictEqual(files, [
            '.github/PULL_REQUEST_TEMPLATE/feature.md',
            '.gitlab/merge_request_templates/default.md',
            'docs/PULL_REQUEST_TEMPLATE/bugfix.md',
        ].sort());
    });

    it('loads template guidance with per-file headers', () => {
        const root = makeTempRepo();
        const guidance = loadTemplateGuidance(root, [
            '.github/PULL_REQUEST_TEMPLATE/feature.md',
            '.gitlab/merge_request_templates/default.md',
        ]);
        assert.ok(guidance.includes('--- .github/PULL_REQUEST_TEMPLATE/feature.md ---'));
        assert.ok(guidance.includes('# GitHub template'));
        assert.ok(guidance.includes('--- .gitlab/merge_request_templates/default.md ---'));
    });

    it('returns an empty string when no templates are configured', () => {
        const root = makeTempRepo();
        assert.strictEqual(loadTemplateGuidance(root, []), '');
    });
});
