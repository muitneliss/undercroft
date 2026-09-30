/**
 * A compose file imported with `with { type: "text" }`: Bun reads it as a string at build
 * time, which is how a compiled installer carries its release's compose file (`compose.ts`).
 */
declare module "*.yml" {
  const text: string;
  export default text;
}
