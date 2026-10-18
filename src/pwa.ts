import { useEffect, useState } from 'react';
type Status = 'preparing' | 'ready' | 'unsupported' | 'error' | 'development';
type ShellState = { status: Status; label: string; detail: string };
function timeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
async function activate(worker: ServiceWorker | null) {
  if (!worker || worker.state === 'activated') return;
  await timeout(
    new Promise<void>((resolve, reject) => {
      const changed = () => {
        if (worker.state === 'activated') {
          worker.removeEventListener('statechange', changed);
          resolve();
        }
        if (worker.state === 'redundant') {
          worker.removeEventListener('statechange', changed);
          reject(new Error('Не удалось сохранить оболочку. Проверьте свободное место.'));
        }
      };
      worker.addEventListener('statechange', changed);
      changed();
    }),
    15000,
    'Подготовка offline заняла слишком много времени.',
  );
}
async function cacheStatus(
  worker: ServiceWorker,
): Promise<{ ready: boolean; count: number; version: string }> {
  return timeout(
    new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        channel.port1.close();
        resolve(event.data);
      };
      worker.postMessage({ type: 'CACHE_STATUS' }, [channel.port2]);
    }),
    5000,
    'Service worker не подтвердил готовность кэша. Повторите подготовку.',
  );
}
export function useOfflineShell() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ShellState>({
    status: 'preparing',
    label: 'Подготавливаем offline…',
    detail: 'Проверяем service worker и локальные ресурсы.',
  });
  useEffect(() => {
    let cancelled = false;
    const update = (next: ShellState) => {
      if (!cancelled) setState(next);
    };
    if (!import.meta.env.PROD) {
      update({
        status: 'development',
        label: 'Offline в production-сборке',
        detail: 'Выполните npm run build и npm run preview.',
      });
      return;
    }
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
      update({
        status: 'unsupported',
        label: 'Offline здесь недоступен',
        detail:
          'Браузер не предоставляет service worker. Нужен поддерживаемый браузер на localhost или HTTPS.',
      });
      return;
    }
    async function prepare() {
      update({
        status: 'preparing',
        label: 'Подготавливаем offline…',
        detail: 'Сохраняем оболочку, код и шрифты на устройстве.',
      });
      try {
        const registration =
          (await navigator.serviceWorker.getRegistration('/')) ||
          (await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }));
        await registration.update().catch(() => {});
        await activate(registration.installing || registration.waiting);
        await timeout(navigator.serviceWorker.ready, 15000, 'Service worker не стал активным.');
        if (!navigator.serviceWorker.controller)
          await timeout(
            new Promise<void>((resolve) => {
              const change = () => {
                if (navigator.serviceWorker.controller) {
                  navigator.serviceWorker.removeEventListener('controllerchange', change);
                  resolve();
                }
              };
              navigator.serviceWorker.addEventListener('controllerchange', change);
              change();
            }),
            10000,
            'Вкладка ещё не управляется service worker. Обновите страницу онлайн.',
          );
        const controller = navigator.serviceWorker.controller;
        if (!controller) throw new Error('Нет активного контроллера offline.');
        const result = await cacheStatus(controller);
        const build = document.querySelector<HTMLMetaElement>(
          'meta[name="offline-build"]',
        )?.content;
        if (!build || !result.version.endsWith(build))
          throw new Error(
            'Версия оболочки обновилась. Обновите страницу онлайн для согласованной сборки.',
          );
        if (!result.ready)
          throw new Error('Кэш оболочки неполон. Подключитесь к сети и повторите подготовку.');
        update({
          status: 'ready',
          label: 'Готов к работе без сети',
          detail: 'Сборка ' + build + ': контроллер и все ' + result.count + ' ресурсов проверены.',
        });
      } catch (error) {
        update({
          status: 'error',
          label: 'Offline не подготовлен',
          detail: error instanceof Error ? error.message : 'Не удалось проверить кэш.',
        });
      }
    }
    void prepare();
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}
