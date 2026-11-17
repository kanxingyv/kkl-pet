/** 构建期注入的全局常量。见 build.mjs 的 define。 */
declare const __DEV__: boolean;
declare const __PET_VERSION__: string;

/** MV3 运行时 API 的最小声明。只用到 runtime / storage，不值得引一份 @types/chrome。 */
declare const chrome:
  | {
      runtime: {
        id: string;
        getURL(path: string): string;
        lastError?: { message?: string };
      };
      storage: {
        sync: {
          get(keys: string | string[]): Promise<Record<string, unknown>>;
          set(items: Record<string, unknown>): Promise<void>;
        };
        local: {
          get(keys: string | string[]): Promise<Record<string, unknown>>;
          set(items: Record<string, unknown>): Promise<void>;
        };
      };
    }
  | undefined;
