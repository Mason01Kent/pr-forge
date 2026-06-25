import * as assert from 'assert';
import { renderMarkdown } from '../markdownRenderer';

describe('renderMarkdown', () => {
  it('renders a pipe table as an HTML table', () => {
    const md = [
      '| Commit | Summary |',
      '| --- | --- |',
      '| abc1234 | Added the thing |',
      '| def5678 | Fixed the other thing |',
    ].join('\n');
    const html = renderMarkdown(md);
    assert.ok(html.includes('<table>'), 'should emit a table');
    assert.ok(html.includes('<th>Commit</th>'), 'should emit header cells');
    assert.ok(html.includes('<td>abc1234</td>'), 'should emit body cells');
    assert.ok(html.includes('<td>Fixed the other thing</td>'));
    assert.ok(!html.includes('| Commit |'), 'raw pipes should not leak');
  });

  it('hides the pr-forge commits marker comment', () => {
    const html = renderMarkdown('<!-- pr-forge:commits -->\n## Commits');
    assert.ok(!html.includes('pr-forge:commits'), 'comment marker should not render');
    assert.ok(html.includes('<h2>Commits</h2>'));
  });

  it('honours escaped pipes inside table cells', () => {
    const md = [
      '| A | B |',
      '| --- | --- |',
      '| x | a \\| b |',
    ].join('\n');
    const html = renderMarkdown(md);
    assert.ok(html.includes('<td>a | b</td>'), 'escaped pipe should become a literal pipe');
  });
});
