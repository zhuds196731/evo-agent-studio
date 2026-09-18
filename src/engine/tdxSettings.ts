const STORAGE_KEY = 'evo/tdx/custom-config';

export function readSavedTdxConfig(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeSavedTdxConfig(config: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, config);
  } catch {
    /* ignore */
  }
}

export function clearSavedTdxConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
