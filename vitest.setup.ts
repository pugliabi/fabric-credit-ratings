import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';

// Unit tests make no network calls. Only the opt-in suites, which need a Functions host or the dev database, may.
if (!process.env.FCR_API_URL && !process.env.FCR_DB_TESTS) {
  const refuse = (): never => {
    throw new Error('Unit tests make no network calls. Mock it, or run with FCR_DB_TESTS or FCR_API_URL.');
  };
  // Every TCP and TLS socket goes through this, mssql's and http's included.
  net.Socket.prototype.connect = refuse;
  Object.assign(net, { connect: refuse, createConnection: refuse });
  Object.assign(tls, { connect: refuse });
  // happy-dom's synchronous loads and @azure/identity's CLI credentials (az, azd, pwsh) run their requests in a child
  // process, where the socket hooks can't see them. A test that truly needs one sets FCR_ALLOW_CHILD_PROCESS=1.
  if (!process.env.FCR_ALLOW_CHILD_PROCESS) {
    for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
      Object.assign(childProcess, { [name]: refuse });
    }
  }
  // So `import { connect } from 'node:net'` (and `execFileSync` from 'node:child_process') see the same functions.
  syncBuiltinESMExports();
  globalThis.fetch = (async () => refuse()) as typeof fetch;
}
