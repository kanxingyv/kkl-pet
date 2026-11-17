/** esbuild 的 text loader 把 .css 变成字符串模块。 */
declare module "*.css" {
  const css: string;
  export default css;
}
