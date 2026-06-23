import * as vscode from 'vscode';
import { PROVIDERS } from './llmClient';

function keyFor(provider: string): string {
  return `prForge.apiKey.${provider}`;
}

export async function getApiKey(context: vscode.ExtensionContext, provider: string): Promise<string | undefined> {
  return context.secrets.get(keyFor(provider));
}

export async function storeApiKey(context: vscode.ExtensionContext, provider: string, key: string): Promise<void> {
  await context.secrets.store(keyFor(provider), key);
}

export async function hasApiKey(context: vscode.ExtensionContext, provider: string): Promise<boolean> {
  const key = await getApiKey(context, provider);
  return key !== undefined && key !== '';
}

export async function deleteApiKey(context: vscode.ExtensionContext, provider: string): Promise<void> {
  await context.secrets.delete(keyFor(provider));
}

export async function promptSetApiKey(
  context: vscode.ExtensionContext,
  _preselectedProvider?: string
): Promise<string | undefined> {
  const providerEntries = Object.entries(PROVIDERS);

  type ProviderPickItem = vscode.QuickPickItem & { provider: string; noAuth: boolean };

  const items: ProviderPickItem[] = providerEntries.map(([id, info]) => ({
    label: info.displayName,
    description: info.noAuth ? '(no key needed)' : '',
    detail: info.noAuth ? undefined : info.baseUrl,
    provider: id,
    noAuth: info.noAuth,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select an AI provider',
  });
  if (!picked) return undefined;

  if (picked.noAuth) {
    await storeApiKey(context, picked.provider, '');
    vscode.window.showInformationMessage(`API key saved for ${picked.label}`);
    return picked.provider;
  }

  const key = await vscode.window.showInputBox({
    prompt: `Enter your API key for ${picked.label}`,
    password: true,
    placeHolder: 'Paste your API key',
    ignoreFocusOut: true,
  });
  if (key === undefined) return undefined;
  if (key.trim() === '') {
    vscode.window.showWarningMessage('API key cannot be empty.');
    return undefined;
  }

  await storeApiKey(context, picked.provider, key.trim());
  vscode.window.showInformationMessage(`API key saved for ${picked.label}`);
  return picked.provider;
}
