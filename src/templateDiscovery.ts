import * as fs from 'fs';
import * as path from 'path';

const TEMPLATE_ROOTS = [
    '.github/PULL_REQUEST_TEMPLATE',
    'PULL_REQUEST_TEMPLATE',
    'docs/PULL_REQUEST_TEMPLATE',
    '.gitlab/merge_request_templates',
];

const TEMPLATE_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '']);

function isTemplateFile(filePath: string, dirent: fs.Dirent): boolean {
    if (dirent.isDirectory()) {
        return false;
    }
    const ext = path.extname(filePath).toLowerCase();
    return TEMPLATE_EXTENSIONS.has(ext);
}

function collectTemplateFiles(rootPath: string, relPath: string, out: string[]): void {
    const absPath = path.join(rootPath, relPath);
    if (!fs.existsSync(absPath)) {
        return;
    }

    const stat = fs.statSync(absPath);
    if (stat.isFile()) {
        out.push(relPath.replace(/\\/g, '/'));
        return;
    }

    if (!stat.isDirectory()) {
        return;
    }

    const entries = fs.readdirSync(absPath, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
        const childRel = path.posix.join(relPath.replace(/\\/g, '/'), entry.name);
        const childAbs = path.join(rootPath, childRel);
        if (entry.isDirectory()) {
            collectTemplateFiles(rootPath, childRel, out);
            continue;
        }
        if (isTemplateFile(childAbs, entry)) {
            out.push(childRel);
        }
    }
}

export function discoverRepositoryTemplateFiles(rootPath: string): string[] {
    const matches: string[] = [];
    for (const relPath of TEMPLATE_ROOTS) {
        collectTemplateFiles(rootPath, relPath, matches);
    }
    return Array.from(new Set(matches));
}

export function loadTemplateGuidance(rootPath: string, templateFiles: string[], maxChars = 10_000): string {
    if (templateFiles.length === 0) {
        return '';
    }

    const chunks: string[] = [];
    let remaining = maxChars;

    for (const relPath of templateFiles) {
        const absPath = path.join(rootPath, relPath);
        if (!fs.existsSync(absPath)) {
            continue;
        }

        const header = `--- ${relPath} ---\n`;
        const content = fs.readFileSync(absPath, 'utf-8').replace(/\r\n/g, '\n');
        const cap = Math.max(0, remaining - header.length);
        if (cap <= 0) {
            break;
        }

        let body = content;
        if (body.length > cap) {
            body = body.slice(0, cap) + `\n\n[...${relPath} truncated]`;
        }
        const chunk = header + body;
        chunks.push(chunk);
        remaining -= chunk.length;
        if (remaining <= 0) {
            break;
        }
    }

    return chunks.join('\n\n');
}
