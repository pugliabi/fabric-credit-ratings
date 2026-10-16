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
  // So `import { connect } from 'node:net'` sees the same functions.
  syncBuiltinESMExports();
  globalThis.fetch = (async () => refuse()) as typeof fetch;
}
