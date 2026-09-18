/// <reference types="vite/client" />

declare module '*?raw' {
  const content: string;
  export default content;
}

declare global {
  interface Window {
    evoTdx?: {
      readDefaultConfig?: () => Promise<{ path: string; text: string } | null>;
    };
  }
}

export {};
