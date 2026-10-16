import { execFileSync } from 'node:child_process';
import http from 'node:http';
import net, { connect } from 'node:net';
import tls from 'node:tls';
import { afterEach, describe, expect, it, vi } from 'vitest';

const REFUSED = 'Unit tests make no network calls. Mock it, or run with FCR_DB_TESTS or FCR_API_URL.';

// Loopback and a closed high port only, so even a broken guard sends nothing off this machine. The port is not on the
// Fetch "bad port" list (9 is), so without its hook `fetch` would try a real connection instead of failing early.
const PORT = 59999;
const HOST = '127.0.0.1';

/** Opens a socket the way `open` does; if the guard let it through, it's dropped at once. */
function attempt(open: () => net.Socket): void {
  const socket = open();
  socket.on('error', () => undefined);
  socket.destroy();
}

/**
 * Checks that `open` is refused by its own hook, before any socket exists: without that hook, node would make a Socket
 * and call its `connect`, where the prototype hook refuses with the same words, so the message alone can't tell.
 */
function refusedBeforeAnySocket(open: () => net.Socket): void {
  const prototype = vi.spyOn(net.Socket.prototype, 'connect');
  expect(() => attempt(open)).toThrow(REFUSED);
  expect(prototype).not.toHaveBeenCalled();
}

/** `http.request` may throw at once or report through the request's error event; either way, the guard's words. */
function request(): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      const req = http.request(`http://${HOST}:${PORT}/`);
      req.on('error', resolve);
      req.end();
    } catch (reason) {
      resolve(reason);
    }
  });
}

// One case per hook in vitest.setup.ts, so removing any one of them turns a test red.
describe.skipIf(process.env.FCR_API_URL || process.env.FCR_DB_TESTS)('the unit-test network guard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses fetch', async () => {
    await expect(fetch(`http://${HOST}:${PORT}/`)).rejects.toThrow(REFUSED);
  });

  it('refuses a socket connecting itself (the prototype hook)', () => {
    expect(() => attempt(() => new net.Socket().connect(PORT, HOST))).toThrow(REFUSED);
  });

  it('refuses net.createConnection', () => {
    refusedBeforeAnySocket(() => net.createConnection(PORT, HOST));
  });

  it('refuses the named import connect from node:net (syncBuiltinESMExports)', () => {
    refusedBeforeAnySocket(() => connect(PORT, HOST));
  });

  it('refuses tls.connect', () => {
    refusedBeforeAnySocket(() => tls.connect(PORT, HOST));
  });

  it('refuses http.request', async () => {
    await expect(request()).resolves.toMatchObject({ message: REFUSED });
  });

  it.skipIf(process.env.FCR_ALLOW_CHILD_PROCESS)(
    'refuses a child process, which could carry a request the socket hooks never see',
    () => {
      expect(() => execFileSync(process.execPath, ['-e', ''])).toThrow(REFUSED);
    },
  );
});
