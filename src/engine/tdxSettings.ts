import type { TdxRuntimeConfig } from '../types';
import defaultTdxConfig from '../../public/tdx/Connect.default.cfg?raw';

/** 旧版独立存储键，只在首次升级时迁移，之后配置统一进入 AppState.tdx。 */
const LEGACY_STORAGE_KEY = 'evo/tdx/custom-config';

export function createTdxConfig(
  config: string,
  source: TdxRuntimeConfig['source'] = 'custom',
  sourcePath?: string,
): TdxRuntimeConfig {
  return {
    config,
    source,
    sourcePath,
    updatedAt: new Date().toISOString(),
    autoLoad: true,
  };
}

export function createDefaultTdxConfig(): TdxRuntimeConfig {
  return createTdxConfig(defaultTdxConfig, 'default');
}

export function readSavedTdxConfig(): string | null {
  try {
    return localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeSavedTdxConfig(config: string): void {
  try {
    localStorage.setItem(LEGACY_STORAGE_KEY, config);
  } catch {
    /* ignore */
  }
}

export function clearSavedTdxConfig(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
