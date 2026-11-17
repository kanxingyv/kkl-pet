/** 统一错误码。API 返回值与 error 事件都用这套。 */
export const PET_ERRORS = {
  MANIFEST: "PET_E_MANIFEST",
  ASSET: "PET_E_ASSET",
  UNREACHABLE: "PET_E_UNREACHABLE",
  TELEPORT: "PET_E_TELEPORT",
  NO_FETCH: "PET_E_NO_FETCH",
  NO_SKIN: "PET_E_NO_SKIN",
  UNSUPPORTED: "PET_E_UNSUPPORTED",
} as const;

export type PetErrorCode = (typeof PET_ERRORS)[keyof typeof PET_ERRORS];

export function warn(msg: string): void {
  if (typeof console !== "undefined") console.warn(`[kkl-pet] ${msg}`);
}

/** 开发期断言。生产构建里 __DEV__ 为 false，整段被 esbuild 摇掉。 */
export function devAssert(cond: boolean, code: PetErrorCode, msg: string): void {
  if (__DEV__ && !cond) {
    console.error(`[kkl-pet] ${code}: ${msg}`);
  }
}
