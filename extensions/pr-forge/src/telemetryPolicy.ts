export function shouldEnableTelemetry(globalEnabled: boolean, extensionEnabled: boolean): boolean {
    return globalEnabled && extensionEnabled;
}
