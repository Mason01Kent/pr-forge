export interface PrForgeConfig {
    schemaVersion: number;
    projectName: string;
    baseBranch: string;
    projectType: string;
    testCommand: string;
    runTestsOnGenerate: boolean;
    includeRecentCommits: boolean;
    outputDirectory: string;
    provider: string;
    defaultModel: string;
    reviewRulesFiles: string[];
    prRiskAreas: string[];
    prBodySections: string[];
}

/** Migrate a raw config object to the current schema, filling defaults for missing fields. */
export function migrateConfig(raw: Record<string, unknown>): PrForgeConfig {
    if (!raw.schemaVersion || (raw.schemaVersion as number) < 3) {
        raw.schemaVersion = 3;
        if (raw.runTestsOnGenerate === undefined) { raw.runTestsOnGenerate = true; }
        if (raw.includeRecentCommits === undefined) { raw.includeRecentCommits = false; }
    }
    return raw as unknown as PrForgeConfig;
}
