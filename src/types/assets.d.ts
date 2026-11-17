/** esbuild 的 text loader 把 .css 变成字符串模块。 */
declare module "*.css" {
  const css: string;
  export default css;
}

/** esbuild 的 dataurl loader 把 webp 转成 base64 data URI 字符串。 */
declare module "*.webp" {
  const dataUri: string;
  export default dataUri;
}
