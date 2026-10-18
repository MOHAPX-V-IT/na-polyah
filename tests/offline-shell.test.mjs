import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

async function workerHarness() {
  const source = await fs.readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const resources = ['/', '/assets/app.js', '/assets/font.woff2'];
  const code = source
    .replaceAll('__BUILD_VERSION__', 'test')
    .replace(
      /const PRECACHE = \[\];?\s*\/\*__PRECACHE__\*\/;?/,
      'const PRECACHE = ' + JSON.stringify(resources) + ';',
    );
  const handlers = new Map();
  const stores = new Map();
  const content = new Map([
    ['/', '<div>shell-old</div>'],
    ['/assets/app.js', 'old-build-js'],
    ['/assets/font.woff2', 'font-bytes'],
  ]);
  let online = true;
  let activated = false;
  const key = (request) =>
    new URL(typeof request === 'string' ? request : request.url, 'http://localhost').pathname;
  const fetch = async (request) => {
    if (!online || !content.has(key(request))) throw new Error('Network unavailable');
    return new Response(content.get(key(request)));
  };
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async addAll(requests) {
          const responses = await Promise.all(
            requests.map(async (request) => [key(request), await fetch(request)]),
          );
          for (const [url, response] of responses) store.set(url, response);
        },
        async match(request, options = {}) {
          if (typeof request !== 'string' && request.headers?.Origin && !options.ignoreVary)
            return undefined;
          return store.get(key(request))?.clone();
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
  };
  vm.runInNewContext(code, {
    self: {
      location: { origin: 'http://localhost' },
      addEventListener(type, handler) {
        handlers.set(type, handler);
      },
      async skipWaiting() {
        activated = true;
      },
      clients: { async claim() {} },
    },
    caches,
    fetch,
    URL,
    Response,
    Request: class {
      constructor(url) {
        this.url = new URL(url, 'http://localhost').href;
      }
    },
  });
  async function emit(type, fields = {}) {
    const tasks = [];
    let response;
    handlers.get(type)({
      ...fields,
      waitUntil(task) {
        tasks.push(task);
      },
      respondWith(task) {
        response = task;
      },
    });
    await Promise.all(tasks);
    return response ? await response : undefined;
  }
  return {
    emit,
    stores,
    content,
    resources,
    setOnline(value) {
      online = value;
    },
    get activated() {
      return activated;
    },
  };
}
test('Offline shell: navigation, JS and font remain one cached build; API bypasses cache', async () => {
  const harness = await workerHarness();
  await harness.emit('install');
  assert.equal(harness.activated, true);
  harness.content.set('/', '<div>shell-new</div>');
  const navigation = { url: 'http://localhost/', method: 'GET', mode: 'navigate' };
  assert.equal(
    await (await harness.emit('fetch', { request: navigation })).text(),
    '<div>shell-old</div>',
  );
  harness.setOnline(false);
  assert.equal(
    await (await harness.emit('fetch', { request: navigation })).text(),
    '<div>shell-old</div>',
  );
  for (const url of ['/assets/app.js', '/assets/font.woff2']) {
    const response = await harness.emit('fetch', {
      request: {
        url: 'http://localhost' + url,
        method: 'GET',
        mode: 'cors',
        headers: { Origin: 'http://localhost' },
      },
    });
    assert.ok((await response.text()).length > 0);
  }
  assert.equal(
    await harness.emit('fetch', {
      request: { url: 'http://localhost/api/inspections', method: 'GET' },
    }),
    undefined,
  );
  let result;
  await harness.emit('message', {
    data: { type: 'CACHE_STATUS' },
    ports: [
      {
        postMessage(value) {
          result = value;
        },
      },
    ],
  });
  assert.equal(result.ready, true);
  assert.equal(result.count, 3);
});
test('Offline readiness rejects incomplete cache; failed install never activates', async () => {
  const harness = await workerHarness();
  await harness.emit('install');
  const name = [...harness.stores.keys()][0];
  harness.stores.get(name).delete('/assets/font.woff2');
  let result;
  await harness.emit('message', {
    data: { type: 'CACHE_STATUS' },
    ports: [
      {
        postMessage(value) {
          result = value;
        },
      },
    ],
  });
  assert.equal(result.ready, false);
  harness.stores.set('unrelated-cache', new Map());
  const old = name.replace('test', 'stale');
  harness.stores.set(old, new Map());
  await harness.emit('activate');
  assert.equal(harness.stores.has(old), false);
  assert.equal(harness.stores.has('unrelated-cache'), true);
  const broken = await workerHarness();
  broken.content.delete('/assets/app.js');
  await assert.rejects(broken.emit('install'), /Network unavailable/);
  assert.equal(broken.activated, false);
});
