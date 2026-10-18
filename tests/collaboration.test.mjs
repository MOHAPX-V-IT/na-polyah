import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import { createDocument, addComment, resolveAnchor, exportDocument } from '../src/document.mjs';
import { createRelay } from '../server/index.mjs';
const wait = async (fn, label = 'условие') => {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`Timeout: ${label}`);
};
test('Якорь следует за вставкой; удалённый фрагмент помечается утраченным, обсуждение остаётся', () => {
  const doc = new Y.Doc();
  const record = createDocument(doc, 'Заголовок', 'Проверяем важную фразу.');
  const comment = addComment(doc, record, 10, 16, 'Уточнить', 'Анна');
  assert.equal(resolveAnchor(doc, record, comment).text, 'важную');
  const text = record.get('body');
  text.insert(0, 'Сначала: ');
  assert.equal(resolveAnchor(doc, record, comment).start, 19);
  let anchor = resolveAnchor(doc, record, comment);
  text.delete(anchor.start, anchor.end - anchor.start);
  assert.equal(resolveAnchor(doc, record, comment), null);
  assert.equal(comment.get('body'), 'Уточнить');
  comment.set('resolved', true);
  const exported = exportDocument(doc, record);
  assert.equal(exported.comments[0].resolved, true);
  assert.equal(exported.comments[0].anchor, null);
  doc.destroy();
});
test('Конкурентные offline изменения текста и комментариев сходятся без потери', () => {
  const a = new Y.Doc(),
    b = new Y.Doc();
  const ra = createDocument(a, 'Текст', 'Один два три');
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const rb = b.getMap('documents').get(ra.get('id'));
  ra.get('body').insert(0, 'А: ');
  rb.get('body').insert(rb.get('body').length, ' Б');
  addComment(a, ra, 0, 1, 'Комментарий А', 'А');
  addComment(b, rb, 0, 4, 'Комментарий Б', 'Б');
  const au = Y.encodeStateAsUpdate(a),
    bu = Y.encodeStateAsUpdate(b);
  Y.applyUpdate(a, bu);
  Y.applyUpdate(b, au);
  assert.equal(ra.get('body').toString(), rb.get('body').toString());
  assert.equal(ra.get('comments').length, 2);
  assert.deepEqual(ra.toJSON(), rb.toJSON());
  a.destroy();
  b.destroy();
});
test('Настоящий WebSocket: sync, awareness, offline reconnect и восстановление с диска', async () => {
  await mkdir('.test-data', { recursive: true });
  const directory = await mkdtemp(path.resolve('.test-data', 'relay-'));
  let relay = await createRelay({ directory, port: 0 });
  const a = new Y.Doc(),
    b = new Y.Doc();
  let url = `ws://127.0.0.1:${relay.server.address().port}`;
  const pa = new WebsocketProvider(url, 'workspace', a, {
      WebSocketPolyfill: WebSocket,
      disableBc: true,
    }),
    pb = new WebsocketProvider(url, 'workspace', b, {
      WebSocketPolyfill: WebSocket,
      disableBc: true,
    });
  let pc;
  try {
    await wait(() => pa.synced && pb.synced, 'начальный sync');
    const ra = a.getMap('documents').get('welcome'),
      rb = b.getMap('documents').get('welcome');
    assert.ok(ra && rb);
    pa.awareness.setLocalStateField('user', { name: 'Анна', color: '#a45135' });
    await wait(
      () => Array.from(pb.awareness.getStates().values()).some((s) => s.user?.name === 'Анна'),
      'реальное присутствие',
    );
    pa.disconnect();
    ra.get('body').insert(0, 'Offline A. ');
    rb.get('body').insert(rb.get('body').length, ' Online B.');
    const c = addComment(a, ra, 0, 7, 'Вопрос offline', 'Анна');
    const commentId = c.get('id');
    await wait(() =>
      relay.doc.getMap('documents').get('welcome').get('body').toString().endsWith(' Online B.'),
    );
    pa.connect();
    await wait(
      () =>
        ra.get('body').toString() === rb.get('body').toString() &&
        rb
          .get('comments')
          .toArray()
          .some((c) => c.get('id') === commentId),
      'reconnect convergence',
    );
    const expected = ra.get('body').toString();
    assert.ok(expected.startsWith('Offline A. '));
    assert.ok(expected.endsWith(' Online B.'));
    pa.destroy();
    pb.destroy();
    await relay.close();
    relay = await createRelay({ directory, port: 0 });
    url = `ws://127.0.0.1:${relay.server.address().port}`;
    const d = new Y.Doc();
    pc = new WebsocketProvider(url, 'workspace', d, {
      WebSocketPolyfill: WebSocket,
      disableBc: true,
    });
    await wait(() => pc.synced, 'sync после рестарта');
    assert.equal(d.getMap('documents').get('welcome').get('body').toString(), expected);
    assert.equal(d.getMap('documents').get('welcome').get('comments').length, 1);
    pc.destroy();
    d.destroy();
  } finally {
    pa.destroy();
    pb.destroy();
    pc?.destroy();
    a.destroy();
    b.destroy();
    await relay.close();
    await rm(directory, { recursive: true, force: true });
  }
});
