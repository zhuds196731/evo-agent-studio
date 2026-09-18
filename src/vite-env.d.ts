/// <reference types="vite/client" />

declare module '*?raw' {
  const content: string;
  export default content;
}

declare global {
  interface Window {
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
  }
}

export {};
