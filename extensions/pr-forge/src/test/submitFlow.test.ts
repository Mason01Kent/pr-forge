import * as assert from 'assert';
import { buildPrSnapshotDocument, isDuplicatePrSubmitError } from '../submitFlow';

describe('submitFlow helpers', () => {
    it('detects duplicate PR submit errors', () => {
        assert.strictEqual(isDuplicatePrSubmitError('A pull request already exists for this branch.'), true);
        assert.strictEqual(isDuplicatePrSubmitError('Another open merge request already exists for this source branch'), true);
        assert.strictEqual(isDuplicatePrSubmitError('No commits between base and head.'), false);
    });

    it('builds a readable PR snapshot document for comparison', () => {
        const doc = buildPrSnapshotDocument(
            'Existing PR',
            { number: 14, url: 'https://example.com/pr/14', title: 'Update docs', body: 'Body text', draft: true },
            { owner: 'owner', repo: 'repo', head: 'feature/x', base: 'main' }
        );
        assert.ok(doc.includes('# Existing PR'));
        assert.ok(doc.includes('Update docs'));
        assert.ok(doc.includes('Body text'));
        assert.ok(doc.includes('feature/x'));
        assert.ok(doc.includes('main'));
    });
});
