import * as assert from 'assert';
import { batchFileDiffs } from '../prGenerator';

describe('batchFileDiffs', () => {
  const CHUNK = 100;

  it('returns a single batch when total diff fits', () => {
    const files = [
      { file: 'a.ts', diff: 'x'.repeat(40) },
      { file: 'b.ts', diff: 'y'.repeat(40) },
    ];
    const batches = batchFileDiffs(files, CHUNK);
    assert.strictEqual(batches.length, 1);
    assert.ok(batches[0].includes('x'.repeat(40)));
    assert.ok(batches[0].includes('y'.repeat(40)));
  });

  it('splits into multiple batches when total exceeds chunkSize', () => {
    const files = [
      { file: 'a.ts', diff: 'a'.repeat(60) },
      { file: 'b.ts', diff: 'b'.repeat(60) },
    ];
    const batches = batchFileDiffs(files, CHUNK);
    assert.strictEqual(batches.length, 2);
    assert.ok(batches[0].includes('a'.repeat(60)));
    assert.ok(batches[1].includes('b'.repeat(60)));
  });

  it('truncates a single oversized file with a note', () => {
    const bigDiff = 'x'.repeat(200);
    const files = [{ file: 'huge.ts', diff: bigDiff }];
    const batches = batchFileDiffs(files, CHUNK);
    assert.strictEqual(batches.length, 1);
    assert.ok(batches[0].includes('[...diff for huge.ts truncated'));
    assert.ok(batches[0].length <= CHUNK + 100); // truncation note is short
  });

  it('returns empty array for empty input', () => {
    assert.deepStrictEqual(batchFileDiffs([], CHUNK), []);
  });

  it('handles exactly chunkSize diff without splitting', () => {
    const files = [{ file: 'exact.ts', diff: 'z'.repeat(CHUNK) }];
    const batches = batchFileDiffs(files, CHUNK);
    assert.strictEqual(batches.length, 1);
  });
});
