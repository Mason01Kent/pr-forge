import { ReviewComment } from './scm/index';

/** A structured review finding emitted by the model. */
export interface Finding {
    file: string;
    line: number;
    severity?: string;
    comment: string;
    /** Optional replacement for the finding's single line (committable suggestion). */
    suggestion?: string;
}

/** Per-file unified diff, as produced by `git diff base..HEAD -- <file>`. */
export interface FileDiff {
    file: string;
    diff: string;
}

/** Right-side diff location plus the matching old-side line when available. */
export interface DiffAnchor {
    rightLine: number;
    oldLine?: number;
}

/** How far to snap a finding's line to the nearest valid diff line before dropping it. */
const SNAP_WINDOW = 3;

/**
 * Parse the set of RIGHT-side (new file) line numbers that GitHub will accept a
 * comment on, from a single file's unified diff. Added (`+`) and context (` `)
 * lines are commentable; removed (`-`) lines are not. Pre-filtering to this set
 * is what prevents the Reviews API from rejecting the whole review with a 422.
 */
export function parseRightSideLines(fileDiff: string): Set<number> {
    const valid = new Set<number>();
    let rightLine = 0;
    let inHunk = false;

    for (const line of fileDiff.split('\n')) {
        const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunk) {
            rightLine = parseInt(hunk[1], 10);
            inHunk = true;
            continue;
        }
        if (!inHunk) { continue; }
        // Diff metadata lines that can appear mid-file
        if (line.startsWith('diff ') || line.startsWith('index ') ||
            line.startsWith('--- ') || line.startsWith('+++ ')) {
            continue;
        }
        const marker = line[0];
        if (marker === '+') {
            valid.add(rightLine);
            rightLine++;
        } else if (marker === ' ' || line === '') {
            valid.add(rightLine);
            rightLine++;
        } else if (marker === '-') {
            // removed line — does not advance the RIGHT counter
        } else if (marker === '\\') {
            // "\ No newline at end of file" — ignore
        }
    }
    return valid;
}

/**
 * Parse right-side diff line positions and keep the matching old-side line when
 * the unified diff exposes it.
 */
export function parseDiffAnchors(fileDiff: string): Map<number, DiffAnchor> {
    const anchors = new Map<number, DiffAnchor>();
    let rightLine = 0;
    let oldLine = 0;
    let inHunk = false;

    for (const line of fileDiff.split('\n')) {
        const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunk) {
            oldLine = parseInt(hunk[1], 10);
            rightLine = parseInt(hunk[2], 10);
            inHunk = true;
            continue;
        }
        if (!inHunk) { continue; }
        if (line.startsWith('diff ') || line.startsWith('index ') ||
            line.startsWith('--- ') || line.startsWith('+++ ')) {
            continue;
        }
        const marker = line[0];
        if (marker === '+') {
            anchors.set(rightLine, { rightLine });
            rightLine++;
        } else if (marker === ' ') {
            anchors.set(rightLine, { rightLine, oldLine });
            rightLine++;
            oldLine++;
        } else if (marker === '-') {
            oldLine++;
        } else if (marker === '\\' || line === '') {
            // ignore
        }
    }
    return anchors;
}

/**
 * Annotate a unified diff so every added/context line is prefixed with its
 * absolute RIGHT-side (new file) line number. This lets the model reference
 * exact line numbers instead of guessing from hunk headers.
 */
export function annotateDiff(fileDiff: string): string {
    const out: string[] = [];
    let rightLine = 0;
    let inHunk = false;
    for (const line of fileDiff.split('\n')) {
        const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunk) { rightLine = parseInt(hunk[1], 10); inHunk = true; out.push(line); continue; }
        if (!inHunk) { continue; }
        const marker = line[0];
        if (marker === '+') { out.push(`${rightLine}\t+ ${line.slice(1)}`); rightLine++; }
        else if (marker === ' ' || line === '') { out.push(`${rightLine}\t  ${line.slice(1)}`); rightLine++; }
        else if (marker === '-') { out.push(`-\t- ${line.slice(1)}`); }
    }
    return out.join('\n');
}

/** Snap a line to the nearest valid line within SNAP_WINDOW, or null if none. */
function snapToValid(line: number, valid: Set<number>): number | null {
    if (valid.has(line)) { return line; }
    for (let d = 1; d <= SNAP_WINDOW; d++) {
        if (valid.has(line - d)) { return line - d; }
        if (valid.has(line + d)) { return line + d; }
    }
    return null;
}

/** Build the inline comment body, appending a committable suggestion block when present. */
export function buildCommentBody(finding: Finding): string {
    const sev = finding.severity ? `**${finding.severity}:** ` : '';
    let body = `${sev}${finding.comment.trim()}`;
    if (finding.suggestion && finding.suggestion.trim()) {
        body += `\n\n\`\`\`suggestion\n${finding.suggestion.replace(/\n+$/, '')}\n\`\`\``;
    }
    return body;
}

/**
 * Map model findings to GitHub line-anchored review comments. Findings whose
 * file isn't in the diff, or whose line can't be snapped to a commentable line,
 * are dropped. Returns the comments plus how many findings were dropped.
 */
export function mapFindingsToComments(
    findings: Finding[],
    fileDiffs: FileDiff[],
): { comments: ReviewComment[]; dropped: number } {
    const diffByFile = new Map(fileDiffs.map(f => [f.file, f.diff]));
    const validByFile = new Map<string, Set<number>>();
    const anchorByFile = new Map<string, Map<number, DiffAnchor>>();
    const comments: ReviewComment[] = [];
    let dropped = 0;

    for (const f of findings) {
        if (!f || typeof f.file !== 'string' || typeof f.line !== 'number' || !f.comment) { dropped++; continue; }
        const diff = diffByFile.get(f.file);
        if (!diff) { dropped++; continue; }
        let valid = validByFile.get(f.file);
        if (!valid) { valid = parseRightSideLines(diff); validByFile.set(f.file, valid); }
        let anchors = anchorByFile.get(f.file);
        if (!anchors) { anchors = parseDiffAnchors(diff); anchorByFile.set(f.file, anchors); }
        const line = snapToValid(Math.round(f.line), valid);
        if (line === null) { dropped++; continue; }
        const anchor = anchors.get(line);
        comments.push({ path: f.file, line, oldLine: anchor?.oldLine, side: 'RIGHT', body: buildCommentBody(f) });
    }
    return { comments, dropped };
}

/** Defensively parse the model's JSON array of findings (tolerates code fences / prose). */
export function parseFindingsJson(text: string): Finding[] {
    try {
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) { return []; }
        const arr = JSON.parse(match[0]) as unknown[];
        const out: Finding[] = [];
        for (const item of arr) {
            if (item && typeof item === 'object') {
                const o = item as Record<string, unknown>;
                if (typeof o.file === 'string' && typeof o.comment === 'string' && (typeof o.line === 'number' || typeof o.line === 'string')) {
                    out.push({
                        file: o.file,
                        line: typeof o.line === 'string' ? parseInt(o.line, 10) : o.line,
                        comment: o.comment,
                        severity: typeof o.severity === 'string' ? o.severity : undefined,
                        suggestion: typeof o.suggestion === 'string' ? o.suggestion : undefined,
                    });
                }
            }
        }
        return out.filter(f => Number.isFinite(f.line));
    } catch {
        return [];
    }
}

/** Render findings as a single fallback comment when inline anchoring fails. */
export function findingsToFallbackComment(findings: Finding[]): string {
    const lines = findings.map(f => {
        const sev = f.severity ? `[${f.severity}] ` : '';
        return `- ${sev}\`${f.file}:${f.line}\` — ${f.comment.trim()}`;
    });
    return `## PR Forge — Review findings\n\n${lines.join('\n')}`;
}
