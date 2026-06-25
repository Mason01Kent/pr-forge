export interface PrForgeConfig {
    schemaVersion: number;
    projectName: string;
    baseBranch: string;
    projectType: string;
    testCommand: string;
    runTestsOnGenerate: boolean;
    includeRecentCommits: boolean;
    includeCommitSummaries: boolean;
    includeFileWalkthrough: boolean;
    reReviewOnPush: boolean;
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
        if (raw.runTestsOnGenerate === undefined) { raw.runTestsOnGenerate = true; }
        if (raw.includeRecentCommits === undefined) { raw.includeRecentCommits = false; }
    }
    if (!raw.schemaVersion || (raw.schemaVersion as number) < 4) {
        if (raw.includeCommitSummaries === undefined) { raw.includeCommitSummaries = false; }
    }
    if (!raw.schemaVersion || (raw.schemaVersion as number) < 5) {
        raw.schemaVersion = 5;
        if (raw.includeFileWalkthrough === undefined) { raw.includeFileWalkthrough = false; }
        if (raw.reReviewOnPush === undefined) { raw.reReviewOnPush = false; }
    }
    return raw as unknown as PrForgeConfig;
}
