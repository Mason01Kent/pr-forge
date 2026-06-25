import * as assert from 'assert';
import {
  parseRightSideLines,
  parseDiffAnchors,
  mapFindingsToComments,
  buildCommentBody,
  parseFindingsJson,
  annotateDiff,
  findingsToFallbackComment,
  Finding,
} from '../reviewComments';

const SAMPLE_DIFF = [
  'diff --git a/src/foo.ts b/src/foo.ts',
  'index 1111111..2222222 100644',
  '--- a/src/foo.ts',
  '+++ b/src/foo.ts',
  '@@ -1,3 +1,4 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '+const c = 4;',
  ' const d = 5;',
].join('\n');

describe('parseRightSideLines', () => {
  it('collects added and context lines, skipping removed lines', () => {
    const valid = parseRightSideLines(SAMPLE_DIFF);
    assert.deepStrictEqual([...valid].sort((a, b) => a - b), [1, 2, 3, 4]);
  });

  it('returns an empty set for a diff with no hunks', () => {
    assert.strictEqual(parseRightSideLines('diff --git a/x b/x\n').size, 0);
  });
});

describe('parseDiffAnchors', () => {
  it('keeps old-side line numbers for unchanged lines', () => {
    const anchors = parseDiffAnchors(SAMPLE_DIFF);
    assert.deepStrictEqual(anchors.get(1), { rightLine: 1, oldLine: 1 });
    assert.deepStrictEqual(anchors.get(4), { rightLine: 4, oldLine: 3 });
  });
});

describe('mapFindingsToComments', () => {
  const fileDiffs = [{ file: 'src/foo.ts', diff: SAMPLE_DIFF }];

  it('keeps a finding on a valid line', () => {
    const { comments, dropped } = mapFindingsToComments([{ file: 'src/foo.ts', line: 4, comment: 'bug' }], fileDiffs);
    assert.strictEqual(dropped, 0);
    assert.strictEqual(comments.length, 1);
    assert.deepStrictEqual(
      { path: comments[0].path, line: comments[0].line, oldLine: comments[0].oldLine, side: comments[0].side },
      { path: 'src/foo.ts', line: 4, oldLine: 3, side: 'RIGHT' },
    );
  });

  it('drops a finding whose line is far outside the diff', () => {
    const { comments, dropped } = mapFindingsToComments([{ file: 'src/foo.ts', line: 100, comment: 'x' }], fileDiffs);
    assert.strictEqual(comments.length, 0);
    assert.strictEqual(dropped, 1);
  });

  it('drops a finding for a file not in the diff', () => {
    const { dropped } = mapFindingsToComments([{ file: 'other.ts', line: 1, comment: 'x' }], fileDiffs);
    assert.strictEqual(dropped, 1);
  });

  it('embeds a committable suggestion block', () => {
    const f: Finding = { file: 'src/foo.ts', line: 3, comment: 'use 4', suggestion: 'const b = 4;' };
    const { comments } = mapFindingsToComments([f], fileDiffs);
    assert.ok(comments[0].body.includes('```suggestion'));
    assert.ok(comments[0].body.includes('const b = 4;'));
  });
});

describe('buildCommentBody', () => {
  it('prefixes severity and omits empty suggestion', () => {
    const body = buildCommentBody({ file: 'a', line: 1, severity: 'security', comment: 'careful' });
    assert.ok(body.startsWith('**security:** careful'));
    assert.ok(!body.includes('```suggestion'));
  });
});

describe('parseFindingsJson', () => {
  it('parses a fenced JSON array and coerces string lines', () => {
    const text = '```json\n[{"file":"a.ts","line":"7","comment":"x"}]\n```';
    const findings = parseFindingsJson(text);
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].line, 7);
  });

  it('returns [] for non-JSON', () => {
    assert.deepStrictEqual(parseFindingsJson('no json here'), []);
  });
});

describe('annotateDiff', () => {
  it('prefixes added/context lines with their new-file line number', () => {
    const annotated = annotateDiff(SAMPLE_DIFF);
    assert.ok(annotated.includes('2\t+ const b = 3;'));
    assert.ok(annotated.includes('1\t  const a = 1;'));
  });
});

describe('findingsToFallbackComment', () => {
  it('renders a bulleted list with file:line refs', () => {
    const out = findingsToFallbackComment([{ file: 'a.ts', line: 5, comment: 'oops', severity: 'nit' }]);
    assert.ok(out.includes('`a.ts:5`'));
    assert.ok(out.includes('oops'));
  });
});
