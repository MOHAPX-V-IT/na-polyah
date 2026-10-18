import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { seed } from '../src/document.mjs';
export async function createRelay({ directory = path.resolve('data'), port = 4414 } = {}) {
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'workspace.bin');
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, await fs.readFile(file));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  seed(doc);
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null);
  const clients = new Map();
  let writeChain = Promise.resolve(),
    timer;
  const persist = () => {
    clearTimeout(timer);
    const snapshot = Y.encodeStateAsUpdate(doc);
    writeChain = writeChain
      .catch(() => {})
      .then(async () => {
        await fs.writeFile(file + '.tmp', snapshot);
        await fs.rename(file + '.tmp', file);
      });
    return writeChain;
  };
  await persist();
  const send = (ws, message) => {
    if (ws.readyState === 1) ws.send(message);
  };
  const broadcast = (message) => {
    for (const ws of clients.keys()) send(ws, message);
  };
  doc.on('update', (update) => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0);
    syncProtocol.writeUpdate(enc, update);
    broadcast(encoding.toUint8Array(enc));
    clearTimeout(timer);
    timer = setTimeout(() => persist().catch((error) => console.error('Диск:', error)), 80);
  });
  awareness.on('update', ({ added, updated, removed }, origin) => {
    const ids = [...added, ...updated, ...removed];
    if (clients.has(origin)) {
      const own = clients.get(origin);
      added.forEach((id) => own.add(id));
      removed.forEach((id) => own.delete(id));
    }
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 1);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, ids));
    broadcast(encoding.toUint8Array(enc));
  });
  const server = http.createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 404, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(
      JSON.stringify(
        req.url === '/health'
          ? { ok: true, clients: clients.size, version: '0.1.0-rc.1' }
          : { error: 'Not found' },
      ),
    );
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin;
    if (
      req.url?.split('?')[0] !== '/workspace' ||
      (origin && !['http://127.0.0.1:4314', 'http://localhost:4314'].includes(origin))
    ) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });
  wss.on('connection', (ws) => {
    clients.set(ws, new Set());
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0);
    syncProtocol.writeSyncStep1(enc, doc);
    send(ws, encoding.toUint8Array(enc));
    if (awareness.getStates().size) {
      const a = encoding.createEncoder();
      encoding.writeVarUint(a, 1);
      encoding.writeVarUint8Array(
        a,
        awarenessProtocol.encodeAwarenessUpdate(
          awareness,
          Array.from(awareness.getStates().keys()),
        ),
      );
      send(ws, encoding.toUint8Array(a));
    }
    ws.on('message', (data) => {
      try {
        const decoder = decoding.createDecoder(new Uint8Array(data));
        const type = decoding.readVarUint(decoder);
        const out = encoding.createEncoder();
        encoding.writeVarUint(out, type);
        if (type === 0) {
          syncProtocol.readSyncMessage(decoder, out, doc, ws);
          if (encoding.length(out) > 1) send(ws, encoding.toUint8Array(out));
        } else if (type === 1)
          awarenessProtocol.applyAwarenessUpdate(
            awareness,
            decoding.readVarUint8Array(decoder),
            ws,
          );
        else if (type === 3) {
          const a = encoding.createEncoder();
          encoding.writeVarUint(a, 1);
          encoding.writeVarUint8Array(
            a,
            awarenessProtocol.encodeAwarenessUpdate(
              awareness,
              Array.from(awareness.getStates().keys()),
            ),
          );
          send(ws, encoding.toUint8Array(a));
        } else ws.close(1003, 'Unknown message');
      } catch {
        ws.close(1007, 'Malformed update');
      }
    });
    ws.on('close', () => {
      awarenessProtocol.removeAwarenessStates(awareness, Array.from(clients.get(ws) || []), null);
      clients.delete(ws);
    });
    ws.on('error', () => {});
  });
  const heartbeat = setInterval(() => {
    for (const ws of clients.keys()) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 25000);
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    server,
    doc,
    awareness,
    persist,
    async close() {
      clearInterval(heartbeat);
      clearTimeout(timer);
      for (const ws of clients.keys()) ws.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => server.close(resolve));
      await persist();
      awareness.destroy();
      doc.destroy();
    },
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const relay = await createRelay();
  console.log('На полях relay · ws://127.0.0.1:4414/workspace · trusted local room');
  const close = async () => {
    await relay.close();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
