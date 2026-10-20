// Packaging-time adaptation of desktop\main.cjs. The source file is not modified; each rewrite must match
// exactly once, so any drift in main.cjs fails the package build instead of shipping a broken or unsafe layout.
export const rewrites = [
  {
    name: "profile-outside-install-directory",
    from: 'const profile = path.join(root, ".runtime", smoke ? "smoke-profile" + (smokeProfile ? "-" + smokeProfile : "") : "profile");',
    to: 'const profile = path.join(process.env.SLOPSIDIAN_DATA_DIR, smoke ? "smoke-profile" + (smokeProfile ? "-" + smokeProfile : "") : "profile");',
  },
  {
    name: "bundled-self-contained-host",
    from: 'const dll = path.join(root, "src", "RonSijm.Slopsidian", "bin", "Debug", "net10.0", "RonSijm.Slopsidian.dll");',
    to: 'const dll = path.join(root, "src", "RonSijm.Slopsidian", "RonSijm.Slopsidian.exe");',
  },
  {
    name: "launch-apphost-directly",
    from: 'backend = spawn("dotnet", [dll, "--urls", "http://127.0.0.1:" + port], {',
    to: 'backend = spawn(dll, ["--urls", "http://127.0.0.1:" + port], {',
  },
  {
    name: "production-environment",
    from: 'ASPNETCORE_ENVIRONMENT: "Development",',
    to: 'ASPNETCORE_ENVIRONMENT: "Production",',
  },
  {
    name: "missing-build-message",
    from: 'throw new Error("Build the prototype first: npm run build");',
    to: 'throw new Error("The bundled .NET host is missing; reinstall Slopsidian.");',
  },
];

export function transformMain(source) {
  let result = source;
  for (const rewrite of rewrites) {
    const count = result.split(rewrite.from).length - 1;
    if (count !== 1) { throw new Error(`desktop/main.cjs changed: rewrite '${rewrite.name}' matched ${count} times (expected 1). Update tools/release/transform-main.mjs.`); }
    result = result.replace(rewrite.from, () => rewrite.to);
  }
  return result;
}
