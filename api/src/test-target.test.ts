import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTarget } from '../../db/target.ts';
import { isRemoteRun, useDevTarget } from './test-target.ts';

vi.mock(import('../../db/target.ts'), () => ({ useTarget: vi.fn() }));

/** useTarget as it behaves when api/local.settings.json names `database`. */
function settingsName(database: string): void {
  vi.mocked(useTarget).mockImplementation(() => {
    vi.stubEnv('SQL_DATABASE', database);
    return [];
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe('useDevTarget', () => {
  it("points db.ts at api/local.settings.json's database when it is fcr-dev", () => {
    for (const database of ['fcr-dev-0f1e2d3c', 'fcr-dev']) {
      settingsName(database);
      expect(() => useDevTarget()).not.toThrow();
    }
    expect(useTarget).toHaveBeenCalledWith([]);
  });

  it('refuses any other database, before a test can write to it', () => {
    for (const database of ['fcr', 'fcr-prod', 'prod-fcr-dev', 'fcr-devprod', 'fcr-development', '']) {
      settingsName(database);
      expect(() => useDevTarget()).toThrow('These tests write rows: point api/local.settings.json at fcr-dev.');
    }
  });

  it('takes an explicit database for a deployed API, and only with an https FCR_API_URL', () => {
    vi.stubEnv('FCR_TEST_DB_SERVER', 'x.database.fabric.microsoft.com');
    vi.stubEnv('FCR_TEST_DB_DATABASE', 'fcr-0f1e2d3c');
    vi.stubEnv('FCR_API_URL', 'http://localhost:7071');
    expect(() => useDevTarget()).toThrow('set an https FCR_API_URL');
    vi.stubEnv('FCR_API_URL', 'https://example.azurewebsites.net');
    expect(() => useDevTarget()).not.toThrow();
    expect(useTarget).toHaveBeenCalledWith(['--server', 'x.database.fabric.microsoft.com', '--database', 'fcr-0f1e2d3c']);
    expect(isRemoteRun()).toBe(true);
  });

  it('refuses half of the explicit pair', () => {
    vi.stubEnv('FCR_TEST_DB_SERVER', 'x.database.fabric.microsoft.com');
    vi.stubEnv('FCR_API_URL', 'https://example.azurewebsites.net');
    expect(() => useDevTarget()).toThrow('Set both');
    expect(useTarget).not.toHaveBeenCalled();
    expect(isRemoteRun()).toBe(false);
  });
});
