export interface KernelServerConfig {
  name:   string;
  hubUrl: string;
  token:  string;
}

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function resolveKernelConfig(
  setting: KernelServerConfig[] | undefined,
  envText: string | null,
): KernelServerConfig[] {
  if (setting && setting.length) return setting;
  if (envText) {
    const env = parseEnvFile(envText);
    const hubUrl = env.JUPYTER_SERVER_URL;
    const token = env.JUPYTER_API_TOKEN;
    if (hubUrl && token) return [{ name: 'default', hubUrl, token }];
  }
  return [];
}
