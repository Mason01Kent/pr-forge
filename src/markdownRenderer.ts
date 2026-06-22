/**
 * Minimal markdown-to-HTML renderer for PR body/review content.
 * Handles the constructs PR bodies actually use — no external deps needed.
 */
export function renderMarkdown(md: string): string {
    const lines = md.split('\n');
    const out: string[] = [];
    let inCodeBlock = false;
    let codeLang = '';
    let codeLines: string[] = [];
    let listTag: string | null = null;

    function flushList(): void {
        if (listTag) {
            out.push(`</${listTag}>`);
            listTag = null;
        }
    }

    function openList(tag: string): void {
        if (listTag !== tag) {
            flushList();
            out.push(`<${tag}>`);
            listTag = tag;
        }
    }

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];

        // Fenced code block open/close
        if (raw.trimStart().startsWith('```')) {
            if (!inCodeBlock) {
                flushList();
                inCodeBlock = true;
                codeLang = raw.trimStart().slice(3).trim();
                codeLines = [];
            } else {
                inCodeBlock = false;
                const escaped = codeLines.map(escapeHtml).join('\n');
                out.push(`<pre><code${codeLang ? ` class="language-${escapeHtml(codeLang)}"` : ''}>${escaped}</code></pre>`);
                codeLines = [];
                codeLang = '';
            }
            continue;
        }

        if (inCodeBlock) {
            codeLines.push(raw);
            continue;
        }

        // Headings
        const h4 = raw.match(/^####\s+(.+)/);
        const h3 = raw.match(/^###\s+(.+)/);
        const h2 = raw.match(/^##\s+(.+)/);
        const h1 = raw.match(/^#\s+(.+)/);
        if (h4) { flushList(); out.push(`<h4>${inlineFormat(h4[1])}</h4>`); continue; }
        if (h3) { flushList(); out.push(`<h3>${inlineFormat(h3[1])}</h3>`); continue; }
        if (h2) { flushList(); out.push(`<h2>${inlineFormat(h2[1])}</h2>`); continue; }
        if (h1) { flushList(); out.push(`<h1>${inlineFormat(h1[1])}</h1>`); continue; }

        // Horizontal rule
        if (/^---+$/.test(raw.trim())) {
            flushList();
            out.push('<hr>');
            continue;
        }

        // Blockquote
        const bq = raw.match(/^>\s*(.*)/);
        if (bq) {
            flushList();
            out.push(`<blockquote><p>${inlineFormat(bq[1])}</p></blockquote>`);
            continue;
        }

        // Unordered list item (- or *)
        const li = raw.match(/^[\-\*]\s+(.+)/);
        if (li) {
            openList('ul');
            out.push(`<li>${inlineFormat(li[1])}</li>`);
            continue;
        }

        // Ordered list item
        const oli = raw.match(/^\d+\.\s+(.+)/);
        if (oli) {
            openList('ol');
            out.push(`<li>${inlineFormat(oli[1])}</li>`);
            continue;
        }

        // Blank line — close list, add paragraph break
        if (raw.trim() === '') {
            flushList();
            out.push('');
            continue;
        }

        // Regular paragraph line
        flushList();
        out.push(`<p>${inlineFormat(raw)}</p>`);
    }

    flushList();
    return out.join('\n');
}

function inlineFormat(text: string): string {
    return escapeHtml(text)
        // Bold+italic
        .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        // Bold
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        // Italic
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // Inline code
        .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
