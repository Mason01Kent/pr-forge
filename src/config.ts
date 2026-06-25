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
    templateFiles: string[];
    prLabels: string[];
    prReviewers: string[];
    prAssignees: string[];
    prMilestone: string;
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
    if (!raw.schemaVersion || (raw.schemaVersion as number) < 6) {
        raw.schemaVersion = 6;
    }
    if (!raw.schemaVersion || (raw.schemaVersion as number) < 7) {
        raw.schemaVersion = 7;
        if (raw.templateFiles === undefined) { raw.templateFiles = []; }
    }
    if (!raw.schemaVersion || (raw.schemaVersion as number) < 8) {
        raw.schemaVersion = 8;
    }
    if (raw.templateFiles === undefined) { raw.templateFiles = []; }
    if (raw.prLabels === undefined) { raw.prLabels = []; }
    if (raw.prReviewers === undefined) { raw.prReviewers = []; }
    if (raw.prAssignees === undefined) { raw.prAssignees = []; }
    if (raw.prMilestone === undefined) { raw.prMilestone = ''; }
    return raw as unknown as PrForgeConfig;
}
