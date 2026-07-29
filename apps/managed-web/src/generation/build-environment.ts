const allowedEnvironmentVariables = new Set([
  "APPDATA",
  "CI",
  "COMSPEC",
  "HOME",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "LOCALAPPDATA",
  "NODE_EXTRA_CA_CERTS",
  "NODE_OPTIONS",
  "NO_PROXY",
  "PATH",
  "PATHEXT",
  "PNPM_HOME",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
]);

export function createIsolatedBuildEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const isolated: NodeJS.ProcessEnv = {
    NODE_ENV: environment.NODE_ENV ?? "test",
  };
  for (const [name, value] of Object.entries(environment)) {
    if (
      value !== undefined &&
      allowedEnvironmentVariables.has(name.toUpperCase())
    ) {
      isolated[name] = value;
    }
  }
  return isolated;
}
