/// <reference types="vite/client" />

declare module '*?raw' {
  const content: string;
  export default content;
}

declare global {
  interface Window {
    evoNet?: {
      request?: (input: {
        url: string;
        method?: 'GET' | 'POST';
        headers?: Record<string, string>;
        body?: string;
      }) => Promise<{ ok: boolean; status: number; text: string }>;
    };
    evoTdx?: {
      readDefaultConfig?: () => Promise<{ path: string; text: string } | null>;
      parseConfig?: (config: string) => Promise<import('./engine/tdxBridge').TdxParseResult>;
      probeConfig?: (
        config: string,
        code: string,
        limit?: number,
      ) => Promise<import('./engine/tdxBridge').TdxProbeResponse>;
      fetchDailyBars?: (
        host: import('./engine/tdxBridge').TdxHost,
        code: string,
        count?: number,
      ) => Promise<{ bars: import('./engine/tdxBridge').TdxBar[]; count: number }>;
      fetchQuotes?: (
        host: import('./engine/tdxBridge').TdxHost,
        codes: (string | { market: number; code: string })[],
      ) => Promise<import('./engine/tdxBridge').TdxQuoteResult>;
      fetchSecurities?: (
        host: import('./engine/tdxBridge').TdxHost,
      ) => Promise<import('./engine/tdxBridge').TdxSecurityResult>;
      fetchSnapshot?: (
        host: import('./engine/tdxBridge').TdxHost,
        market?: 'sh' | 'sz' | 'all',
        force?: boolean,
      ) => Promise<import('./engine/tdxBridge').TdxSnapshotResult>;
      fetchFinance?: (
        host: import('./engine/tdxBridge').TdxHost,
        code: string,
      ) => Promise<import('./engine/tdxBridge').TdxFinanceResult>;
      autoConnect?: (
        config: string,
        code?: string,
        count?: number,
        limit?: number,
      ) => Promise<import('./engine/tdxBridge').TdxAutoConnectResult>;
    };
    evoWeb?: {
      searchNews?: (query: string) => Promise<{
        refs?: {
          title: string;
          extract: string;
          source?: string;
          url?: string;
          publishedAt?: string;
        }[];
      }>;
    };
    evoPc?: {
      junkScan?: () => Promise<import('./engine/pcBridge').PcResult<import('./engine/pcBridge').JunkScan>>;
      junkClean?: (ids: string[]) => Promise<import('./engine/pcBridge').PcResult<import('./engine/pcBridge').CleanResult>>;
      softwareList?: () => Promise<import('./engine/pcBridge').PcResult<{ items: import('./engine/pcBridge').InstalledApp[] }>>;
      softwareUninstall?: (entries: { name: string; uninstallString: string }[]) => Promise<import('./engine/pcBridge').PcResult<unknown>>;
      networkDiagnose?: () => Promise<import('./engine/pcBridge').PcResult<import('./engine/pcBridge').NetworkDiagnose>>;
      networkRepair?: (action: string) => Promise<import('./engine/pcBridge').PcResult<import('./engine/pcBridge').RepairResult>>;
      systemReport?: () => Promise<import('./engine/pcBridge').PcResult<import('./engine/pcBridge').SystemReport>>;
      runTool?: (kind: string, payload?: Record<string, unknown>) => Promise<import('./engine/pcBridge').PcResult<Record<string, unknown>>>;
    };
    evoTv?: {
      base?: () => Promise<string>;
    };
  }
}

export {};
