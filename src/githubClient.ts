import * as https from 'https';

export interface PrPayload {
    owner: string;
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
    token: string;
    draft?: boolean;
}

export interface PrResult {
    url: string;
    number: number;
}

export interface FindPrOptions {
    owner: string;
    repo: string;
    /** head branch name without owner prefix */
    head: string;
    token: string;
}

export interface UpdatePrOptions {
    owner: string;
    repo: string;
    number: number;
    title: string;
    body: string;
    token: string;
}

/**
 * Parse a GitHub remote URL into owner/repo.
 * Handles both HTTPS (https://github.com/owner/repo.git) and
 * SSH (git@github.com:owner/repo.git) formats.
 */
export function parseGitHubRemote(remoteUrl: string): { owner: string; repo: string } | null {
    // HTTPS: https://github.com/owner/repo.git or https://github.com/owner/repo
    const httpsMatch = remoteUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/\s]+?)(?:\.git)?$/);
    if (httpsMatch) {
        return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }

    // SSH: git@github.com:owner/repo.git
    const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/([^/\s]+?)(?:\.git)?$/);
    if (sshMatch) {
        return { owner: sshMatch[1], repo: sshMatch[2] };
    }

    return null;
}

/**
 * Create a GitHub Pull Request via the REST API using Node's built-in https module.
 */
export function createPullRequest(payload: PrPayload): Promise<PrResult> {
    const { owner, repo, title, body, head, base, token, draft } = payload;

    const requestBody = JSON.stringify({ title, body, head, base, draft: draft ?? false });
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`;

    const options: https.RequestOptions = {
        hostname: 'api.github.com',
        path,
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'User-Agent': 'pr-forge-vscode',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Length': Buffer.byteLength(requestBody).toString(),
        },
    };

    return new Promise<PrResult>((resolve, reject) => {
        const req = https.request(options, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf-8');
                let json: { html_url?: string; number?: number; message?: string; errors?: Array<{ message?: string; code?: string; field?: string }> };
                try {
                    json = JSON.parse(raw);
                } catch {
                    reject(new Error(`GitHub API returned invalid JSON (status ${res.statusCode}): ${raw.slice(0, 200)}`));
                    return;
                }

                if (res.statusCode === 201 && json.html_url && json.number) {
                    resolve({ url: json.html_url, number: json.number });
                } else {
                    // Build a detailed error including any validation sub-errors
                    let msg = json.message || `GitHub API error ${res.statusCode}`;
                    if (json.errors && json.errors.length > 0) {
                        const details = json.errors.map(e => e.message || e.code || e.field || JSON.stringify(e)).join('; ');
                        msg += ` — ${details}`;
                    }
                    reject(new Error(msg));
                }
            });
        });

        req.on('error', (err: Error) => {
            reject(new Error(`Failed to reach GitHub API: ${err.message}`));
        });

        req.write(requestBody);
        req.end();
    });
}

/**
 * Find an open PR whose head branch matches. Returns the PR number + URL, or null.
 */
export function findOpenPullRequest(options: FindPrOptions): Promise<PrResult | null> {
    const { owner, repo, head, token } = options;
    const query = `head=${encodeURIComponent(owner)}%3A${encodeURIComponent(head)}&state=open&per_page=1`;
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?${query}`;

    const reqOptions: https.RequestOptions = {
        hostname: 'api.github.com',
        path,
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'pr-forge-vscode',
            'X-GitHub-Api-Version': '2022-11-28',
        },
    };

    return new Promise<PrResult | null>((resolve, reject) => {
        const req = https.request(reqOptions, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf-8');
                let json: Array<{ html_url?: string; number?: number }>;
                try {
                    json = JSON.parse(raw);
                } catch {
                    reject(new Error(`GitHub API returned invalid JSON (status ${res.statusCode})`));
                    return;
                }
                if (!Array.isArray(json) || json.length === 0) {
                    resolve(null);
                    return;
                }
                const pr = json[0];
                if (pr.html_url && pr.number) {
                    resolve({ url: pr.html_url, number: pr.number });
                } else {
                    resolve(null);
                }
            });
        });
        req.on('error', (err: Error) => reject(new Error(`Failed to reach GitHub API: ${err.message}`)));
        req.end();
    });
}

/**
 * Update the title and body of an existing PR via PATCH.
 */
export function updatePullRequest(options: UpdatePrOptions): Promise<PrResult> {
    const { owner, repo, number, title, body, token } = options;
    const requestBody = JSON.stringify({ title, body });
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`;

    const reqOptions: https.RequestOptions = {
        hostname: 'api.github.com',
        path,
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'User-Agent': 'pr-forge-vscode',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Length': Buffer.byteLength(requestBody).toString(),
        },
    };

    return new Promise<PrResult>((resolve, reject) => {
        const req = https.request(reqOptions, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf-8');
                let json: { html_url?: string; number?: number; message?: string };
                try {
                    json = JSON.parse(raw);
                } catch {
                    reject(new Error(`GitHub API returned invalid JSON (status ${res.statusCode})`));
                    return;
                }
                if (res.statusCode === 200 && json.html_url && json.number) {
                    resolve({ url: json.html_url, number: json.number });
                } else {
                    reject(new Error(json.message || `GitHub API error ${res.statusCode}`));
                }
            });
        });
        req.on('error', (err: Error) => reject(new Error(`Failed to reach GitHub API: ${err.message}`)));
        req.write(requestBody);
        req.end();
    });
}
