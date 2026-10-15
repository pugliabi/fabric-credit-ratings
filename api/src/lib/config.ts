export interface Config {
  allowedOrigins: string[];
  cookieSecure: boolean;
  snapshotToken: string;
  github: { token: string; repo: string; branch: string; workflow: string };
  anthropic: { apiKey: string; workspaceId: string; model: string };
}

function setting(name: string): string {
  return process.env[name]?.trim() ?? '';
}

export function loadConfig(): Config {
  return {
    allowedOrigins: setting('ALLOWED_ORIGINS')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    cookieSecure: setting('COOKIE_SECURE') !== 'false',
    snapshotToken: setting('SNAPSHOT_TOKEN'),
    github: {
      token: setting('GITHUB_DISPATCH_TOKEN'),
      repo: setting('GITHUB_REPO'),
      branch: setting('GITHUB_BRANCH') || 'main',
      workflow: setting('GITHUB_WORKFLOW') || 'deploy.yml',
    },
    anthropic: {
      apiKey: setting('ANTHROPIC_API_KEY'),
      workspaceId: setting('ANTHROPIC_WORKSPACE_ID'),
      model: setting('ANTHROPIC_MODEL'),
    },
  };
}
