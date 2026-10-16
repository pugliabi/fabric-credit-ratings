import net from 'node:net';
import tls from 'node:tls';
import { describe, expect, it } from 'vitest';

const REFUSED = 'Unit tests make no network calls. Mock it, or run with FCR_DB_TESTS or FCR_API_URL.';

/** Opens a socket the way `open` does; if the guard let it through, it's dropped at once. */
function attempt(open: () => net.Socket): void {
  const socket = open();
  socket.on('error', () => undefined);
  socket.destroy();
}

// Loopback and the discard port only, so even a broken guard sends nothing off this machine.
describe.skipIf(process.env.FCR_API_URL || process.env.FCR_DB_TESTS)('the unit-test network guard', () => {
  it('refuses fetch', async () => {
    await expect(fetch('http://127.0.0.1:9/')).rejects.toThrow(REFUSED);
  });

  it('refuses every way of opening a socket', () => {
    expect(() => attempt(() => net.connect(9, '127.0.0.1'))).toThrow(REFUSED);
    expect(() => attempt(() => net.createConnection(9, '127.0.0.1'))).toThrow(REFUSED);
    expect(() => attempt(() => new net.Socket().connect(9, '127.0.0.1'))).toThrow(REFUSED);
    expect(() => attempt(() => tls.connect(9, '127.0.0.1'))).toThrow(REFUSED);
  });
});
