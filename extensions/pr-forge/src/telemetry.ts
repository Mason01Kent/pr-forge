import * as vscode from 'vscode';
import { TelemetryReporter } from '@vscode/extension-telemetry';
import { shouldEnableTelemetry } from './telemetryPolicy';

const CONNECTION_STRING = 'InstrumentationKey=906a3df3-667a-4b01-bddc-230d2becdb02;IngestionEndpoint=https://eastus-8.in.applicationinsights.azure.com/;LiveEndpoint=https://eastus.livediagnostics.monitor.azure.com/;ApplicationId=f9d8ca52-a27b-401d-bff3-9ad18a28c105';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let reporter: any | undefined;

export function isTelemetryOptedIn(): boolean {
    return shouldEnableTelemetry(
        vscode.env.isTelemetryEnabled,
        vscode.workspace.getConfiguration('prForge').get<boolean>('telemetry.enabled', true) !== false
    );
}

function ensureReporter(): void {
    if (!reporter) {
        reporter = new TelemetryReporter(CONNECTION_STRING);
    }
}

export function initTelemetry(_extensionVersion: string): void {
    try {
        if (isTelemetryOptedIn()) {
            ensureReporter();
        }
    } catch {
        // Telemetry is non-critical - never let it crash the extension.
        reporter = undefined;
    }
}

export function disposeTelemetry(): void {
    reporter?.dispose();
    reporter = undefined;
}

export function telemetryEvent(
    name: string,
    properties?: Record<string, string>,
    measurements?: Record<string, number>
): void {
    try {
        if (!isTelemetryOptedIn()) { return; }
        ensureReporter();
        reporter?.sendTelemetryEvent(name, properties, measurements);
    } catch {
        // non-critical
    }
}

export function telemetryError(
    name: string,
    properties?: Record<string, string>,
    measurements?: Record<string, number>
): void {
    try {
        if (!isTelemetryOptedIn()) { return; }
        ensureReporter();
        reporter?.sendTelemetryErrorEvent(name, properties, measurements);
    } catch {
        // non-critical
    }
}

/** Classify an error without leaking message content (paths, repo names, etc.) */
export function classifyError(err: unknown): string {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (msg === 'request cancelled') { return 'cancelled'; }
    if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('api key')) { return 'auth'; }
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota')) { return 'rate_limit'; }
    if (msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('network') || msg.includes('request failed')) { return 'network'; }
    if (msg.includes('context length') || msg.includes('token') || msg.includes('max_tokens')) { return 'token_limit'; }
    return 'unknown';
}
