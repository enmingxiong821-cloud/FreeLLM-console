import net from 'node:net';

export function isPortFree(port, host = '127.0.0.1', timeout = 700) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    let settled = false;
    const done = (free) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(free);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(false));
    socket.once('timeout', () => done(true));
    socket.once('error', () => done(true));
  });
}

export async function findFreePort(start, host = '127.0.0.1', attempts = 40) {
  for (let port = start; port < start + attempts; port++) {
    if (await isPortFree(port, host)) return port;
  }
  return 0;
}
