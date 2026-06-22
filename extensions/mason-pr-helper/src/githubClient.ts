import * as https from 'https';

export interface PrPayload {
    owner: string;
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
    token: string;
}

export interface PrResult {
    url: string;
    number: number;
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
    const { owner, repo, title, body, head, base, token } = payload;

    const requestBody = JSON.stringify({ title, body, head, base });
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`;

    const options: https.RequestOptions = {
        hostname: 'api.github.com',
        path,
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'User-Agent': 'mason-pr-helper-vscode',
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
                let json: { html_url?: string; number?: number; message?: string };
                try {
                    json = JSON.parse(raw);
                } catch {
                    reject(new Error(`GitHub API returned invalid JSON (status ${res.statusCode})`));
                    return;
                }

                if (res.statusCode === 201 && json.html_url && json.number) {
                    resolve({ url: json.html_url, number: json.number });
                } else {
                    reject(new Error(json.message || `GitHub API error ${res.statusCode}`));
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
