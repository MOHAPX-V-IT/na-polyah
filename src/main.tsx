import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import {
  Archive,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  FileText,
  MessageSquare,
  Plus,
  Redo2,
  Search,
  Send,
  Undo2,
  Users,
  X,
  Link2,
  AlertCircle,
  WifiOff,
  BookOpen,
} from 'lucide-react';
import { createDocument, addComment, resolveAnchor, exportDocument } from './document.mjs';
import { DocumentEditor, type EditorHandle } from './Editor';
import { useOfflineShell } from './pwa';
import { Modal } from './Modal';
import '@fontsource/golos-text/cyrillic-400.css';
import '@fontsource/golos-text/latin-400.css';
import '@fontsource/golos-text/cyrillic-500.css';
import '@fontsource/golos-text/latin-500.css';
import '@fontsource/golos-text/cyrillic-600.css';
import '@fontsource/golos-text/latin-600.css';
import '@fontsource/golos-text/cyrillic-700.css';
import '@fontsource/golos-text/latin-700.css';
import '@fontsource/literata/cyrillic-400.css';
import '@fontsource/literata/latin-400.css';
import '@fontsource/literata/cyrillic-500.css';
import '@fontsource/literata/latin-500.css';
import '@fontsource/literata/cyrillic-600.css';
import '@fontsource/literata/latin-600.css';
import './style.css';
import './editorial-theme.css';
const workspace = new Y.Doc();
const persistence = new IndexeddbPersistence('na-polyah-workspace-v1', workspace);
const provider = new WebsocketProvider('ws://127.0.0.1:4414', 'workspace', workspace, {
  connect: false,
  disableBc: true,
});
const palette = ['#9f5038', '#536d82', '#7d6389', '#687949', '#b08035'];
const userColor = palette[workspace.clientID % palette.length];
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join('')
    .toUpperCase() || 'Р';
function save(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function App() {
  const shell = useOfflineShell();
  const [revision, setRevision] = useState(0),
    [localReady, setLocalReady] = useState(false),
    [status, setStatus] = useState('connecting'),
    [synced, setSynced] = useState(false),
    [selected, setSelected] = useState(localStorage.getItem('np-selected') || 'welcome'),
    [name, setName] = useState(
      localStorage.getItem('np-name') || `Редактор ${String(workspace.clientID).slice(-3)}`,
    ),
    [query, setQuery] = useState(''),
    [archived, setArchived] = useState(false),
    [filter, setFilter] = useState('open'),
    [comment, setComment] = useState(''),
    [selection, setSelection] = useState({ start: 0, end: 0 }),
    [editor, setEditor] = useState<EditorHandle | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [peers, setPeers] = useState<any[]>([]),
    [newOpen, setNewOpen] = useState(false),
    [newTitle, setNewTitle] = useState(''),
    [composer, setComposer] = useState(false),
    [focusedComment, setFocusedComment] = useState(''),
    [reply, setReply] = useState(''),
    [share, setShare] = useState(false),
    [lastLocal, setLastLocal] = useState('');
  const commentInput = useRef<HTMLTextAreaElement>(null);
  const docs = workspace.getMap<Y.Map<any>>('documents');
  useEffect(() => {
    const update = () => {
      setRevision((n) => n + 1);
      setLastLocal(new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }));
    };
    workspace.on('update', update);
    const wsStatus = ({ status }: { status: string }) => {
      setStatus(status);
      if (status !== 'connected') setSynced(false);
    };
    const sync = (value: boolean) => setSynced(value);
    const awareness = () =>
      setPeers(
        Array.from(provider.awareness.getStates().entries())
          .filter(([id]) => id !== workspace.clientID)
          .map(([id, state]) => ({ id, ...state })),
      );
    provider.on('status', wsStatus);
    provider.on('sync', sync);
    provider.awareness.on('change', awareness);
    persistence.whenSynced
      .then(() => {
        setLocalReady(true);
        provider.connect();
      })
      .catch((e) => setError(`Не удалось открыть IndexedDB: ${e.message}`));
    const connectionError = () =>
      setError(
        'Совместный канал недоступен. Изменения остаются на устройстве; подключение повторится автоматически.',
      );
    provider.on('connection-error', connectionError);
    const pageClose = () => provider.awareness.setLocalState(null);
    window.addEventListener('beforeunload', pageClose);
    return () => {
      workspace.off('update', update);
      provider.off('status', wsStatus);
      provider.off('sync', sync);
      provider.awareness.off('change', awareness);
      provider.off('connection-error', connectionError);
      window.removeEventListener('beforeunload', pageClose);
    };
  }, []);
  useEffect(() => {
    provider.awareness.setLocalStateField('user', {
      name: name || 'Редактор',
      color: userColor,
      colorLight: userColor + '33',
    });
    localStorage.setItem('np-name', name);
  }, [name]);
  useEffect(() => {
    localStorage.setItem('np-selected', selected);
    provider.awareness.setLocalStateField('documentId', selected);
    setSelection({ start: 0, end: 0 });
    setComposer(false);
    setFocusedComment('');
  }, [selected]);
  useEffect(() => {
    if (status === 'connected' && synced) setError('');
  }, [status, synced]);
  const all = Array.from(docs.values());
  const visible = all.filter(
    (d) =>
      Boolean(d.get('archived')) === archived &&
      d.get('title').toString().toLowerCase().includes(query.toLowerCase()),
  );
  const active = docs.get(selected);
  const comments: Y.Map<any>[] = active?.get('comments').toArray() || [];
  const unresolved = comments.filter((c) => !c.get('resolved'));
  const orphaned = comments.filter((c) => !resolveAnchor(workspace, active, c));
  const displayed = comments.filter(
    (c) =>
      filter === 'all' ||
      (filter === 'resolved' && c.get('resolved')) ||
      (filter === 'open' && !c.get('resolved')) ||
      (filter === 'orphan' && !resolveAnchor(workspace, active, c)),
  );
  const text = active?.get('body').toString() || '';
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const titleChange = (value: string) => {
    if (!active) return;
    const title = active.get('title') as Y.Text;
    workspace.transact(() => {
      title.delete(0, title.length);
      title.insert(0, value.slice(0, 200));
    });
  };
  const create = (e: React.FormEvent) => {
    e.preventDefault();
    const record = createDocument(workspace, newTitle.trim() || 'Новый документ');
    setSelected(record.get('id'));
    setNewOpen(false);
    setNewTitle('');
    setArchived(false);
  };
  const exportFile = (json: boolean) => {
    if (!active) return;
    const doc = exportDocument(workspace, active);
    const safe = doc.title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 100) || 'Документ';
    save(
      safe + (json ? '.json' : '.txt'),
      json ? JSON.stringify(doc, null, 2) : doc.text,
      json ? 'application/json' : 'text/plain;charset=utf-8',
    );
  };
  const beginComment = () => {
    if (selection.end <= selection.start) {
      setNotice('Выделите мышью или клавиатурой фрагмент текста, затем нажмите «Обсудить».');
      return;
    }
    setComposer(true);
    setNotice('');
    setTimeout(() => commentInput.current?.focus(), 0);
  };
  const submitComment = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      addComment(workspace, active, selection.start, selection.end, comment, name || 'Редактор');
      setComment('');
      setComposer(false);
      setFilter('open');
      setNotice('Комментарий добавлен.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const jump = (c: Y.Map<any>) => {
    if (!active || !editor) return;
    const anchor = resolveAnchor(workspace, active, c);
    if (!anchor) {
      setNotice('Исходный фрагмент удалён. Комментарий сохранён для истории.');
      return;
    }
    editor.view.dispatch({
      selection: { anchor: anchor.start, head: anchor.end },
      scrollIntoView: true,
    });
    editor.view.focus();
    setFocusedComment(c.get('id'));
  };
  const addReply = (e: React.FormEvent, c: Y.Map<any>) => {
    e.preventDefault();
    if (!reply.trim()) return;
    workspace.transact(() => {
      if (!c.get('replies')) c.set('replies', new Y.Array());
      c.get('replies').push([
        {
          id: crypto.randomUUID(),
          body: reply.trim(),
          author: name || 'Редактор',
          createdAt: new Date().toISOString(),
        },
      ]);
    });
    setReply('');
  };
  const archive = () => {
    if (!active) return;
    active.set('archived', !active.get('archived'));
    setNotice(
      active.get('archived')
        ? 'Документ перемещён в архив. Его можно восстановить.'
        : 'Документ восстановлен.',
    );
  };
  const presentHere = peers.filter((p) => p.documentId === selected && p.user);
  const connectionLabel =
    status === 'connected' && synced
      ? 'Общая комната онлайн'
      : status === 'connecting'
        ? 'Подключаемся…'
        : 'Работа на устройстве';
  return (
    <div className="app">
      <aside className="library">
        <a className="brand" href="/">
          <span className="monogram">
            н<span>п</span>
          </span>
          <div>
            на полях<small>ТЕКСТЫ СТАНОВЯТСЯ ЛУЧШЕ ВМЕСТЕ</small>
          </div>
        </a>
        <div className="workspace-name">
          <span className="small-mark">Р</span>
          <div>
            Редакционная комната<small>Локальное пространство</small>
          </div>
          <ChevronDown size={13} />
        </div>
        <div className="library-title">
          <span>{archived ? 'АРХИВ' : 'ДОКУМЕНТЫ'}</span>
          <button
            title="Новый документ"
            aria-label="Новый документ"
            onClick={() => setNewOpen(true)}
          >
            <Plus size={19} />
          </button>
        </div>
        <label className="search">
          <Search size={14} />
          <input
            placeholder="Найти документ"
            aria-label="Поиск документов"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <nav className="doc-list">
          {visible.map((d) => {
            const id = d.get('id'),
              open = d
                .get('comments')
                .toArray()
                .filter((c: Y.Map<any>) => !c.get('resolved')).length;
            return (
              <button
                key={id}
                className={selected === id ? 'selected' : ''}
                onClick={() => setSelected(id)}
              >
                <FileText size={17} />
                <span>{d.get('title').toString() || 'Без названия'}</span>
                {open > 0 && <small>{open}</small>}
              </button>
            );
          })}
          {!visible.length && (
            <p className="empty-library">
              {!localReady
                ? 'Открываем локальную библиотеку…'
                : archived
                  ? 'Архив пуст.'
                  : 'Создайте документ или дождитесь подключения к комнате.'}
            </p>
          )}
        </nav>
        <button className="new-document" onClick={() => setNewOpen(true)}>
          <Plus size={15} />
          Новый документ
        </button>
        <div className="library-bottom">
          <button onClick={() => setArchived(!archived)} className={archived ? 'selected' : ''}>
            <Archive size={16} />
            {archived ? 'Вернуться к документам' : 'Архив документов'}
            <span>{all.filter((d) => d.get('archived')).length}</span>
          </button>
          <div className="identity">
            <span className="avatar" style={{ background: userColor }}>
              {initials(name)}
            </span>
            <label>
              Вы в этой комнате
              <input
                aria-label="Ваше имя"
                maxLength={50}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          </div>
          <small className="local-save">
            <span className={'status-dot ' + (localReady ? '' : 'muted')} />
            {localReady ? 'Локальное хранилище открыто' : 'Подготовка хранилища'}
          </small>
          <small className="local-save" data-offline-state={shell.status} title={shell.detail}>
            <span className={'status-dot ' + (shell.status === 'ready' ? '' : 'muted')} />
            {shell.label}
          </small>
          {shell.status === 'error' && (
            <button onClick={shell.retry}>Повторить подготовку offline</button>
          )}
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            <BookOpen size={15} />
            Редакция
            <ChevronRight size={13} />
            <strong>{active?.get('title').toString() || 'Библиотека'}</strong>
          </div>
          <div className="topbar-right">
            <span className="connection">
              <span className={'status-dot ' + (status === 'connected' && synced ? '' : 'muted')} />
              {connectionLabel}
            </span>
            <button className="share-button" onClick={() => setShare(!share)}>
              <Users size={15} />
              Пригласить
            </button>
          </div>
        </header>
        {(error || notice) && (
          <div className={'notice ' + (error ? 'error' : '')} role={error ? 'alert' : 'status'}>
            {error ? <AlertCircle size={16} /> : <Check size={16} />}
            <span>{error || notice}</span>
            <button
              aria-label="Скрыть уведомление"
              onClick={() => {
                setError('');
                setNotice('');
              }}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {share && (
          <section className="share-panel">
            <div>
              <h3>Одна комната — несколько соавторов</h3>
              <p>
                Откройте <b>http://127.0.0.1:4314</b> в другом браузере или профиле. Все документы
                этой локальной комнаты будут доступны участнику.
              </p>
              <small>
                Сервер работает на этом компьютере. Это доверенная комната без разграничения
                доступа.
              </small>
            </div>
            <button
              onClick={() =>
                void navigator.clipboard
                  .writeText('http://127.0.0.1:4314')
                  .then(() => setNotice('Адрес скопирован.'))
                  .catch(() => setNotice('Адрес для копирования: http://127.0.0.1:4314'))
              }
            >
              <Link2 size={15} />
              Копировать адрес
            </button>
          </section>
        )}
        {active ? (
          <>
            <div className="document-header">
              <div>
                <div className="doc-kicker">
                  <span className="document-dot" />
                  РАБОЧИЙ ДОКУМЕНТ<span> / </span>
                  {active.get('archived') ? 'АРХИВ' : 'ОБЩАЯ РЕДАКЦИЯ'}
                </div>
                <input
                  aria-label="Название документа"
                  className="document-title"
                  maxLength={200}
                  value={active.get('title').toString()}
                  onChange={(e) => titleChange(e.target.value)}
                />
                <div className="document-meta">
                  <span>
                    Создан{' '}
                    {new Date(active.get('createdAt')).toLocaleDateString('ru', {
                      day: 'numeric',
                      month: 'long',
                    })}
                  </span>
                  <i /> <span>{wordCount} слов</span>
                  <i />
                  <span>{unresolved.length} открытых обсуждений</span>
                </div>
              </div>
              <div className="collaborators">
                <div className="avatar-stack">
                  <span className="avatar" title={`${name} (вы)`} style={{ background: userColor }}>
                    {initials(name)}
                  </span>
                  {presentHere.slice(0, 4).map((p) => (
                    <span
                      className="avatar"
                      key={p.id}
                      title={p.user.name}
                      style={{ background: p.user.color }}
                    >
                      {initials(p.user.name)}
                    </span>
                  ))}
                </div>
                <small>
                  {presentHere.length
                    ? `${presentHere.length + 1} редактора здесь`
                    : 'Вы в документе'}
                </small>
              </div>
            </div>
            <div className="editor-toolbar">
              <div className="editing-label">
                <span className="pencil-dot" />
                Совместное редактирование
              </div>
              <div className="toolbar-actions">
                <button
                  aria-label="Отменить своё изменение"
                  title="Отменить своё изменение · Ctrl+Z"
                  onClick={() => editor?.undo.undo()}
                >
                  <Undo2 size={16} />
                </button>
                <button
                  aria-label="Повторить своё изменение"
                  title="Повторить · Ctrl+Shift+Z"
                  onClick={() => editor?.undo.redo()}
                >
                  <Redo2 size={16} />
                </button>
                <span className="separator" />
                <button className="comment-trigger" onClick={beginComment}>
                  <MessageSquare size={15} />
                  Обсудить фрагмент
                </button>
                <span className="separator" />
                <button title="Скачать текст" onClick={() => exportFile(false)}>
                  <ArrowDownToLine size={15} />
                  TXT
                </button>
                <button title="Скачать текст и обсуждения" onClick={() => exportFile(true)}>
                  JSON
                </button>
                <button
                  title={active.get('archived') ? 'Восстановить документ' : 'В архив'}
                  aria-label={active.get('archived') ? 'Восстановить документ' : 'В архив'}
                  onClick={archive}
                >
                  <Archive size={15} />
                </button>
              </div>
            </div>
            <div className="review-layout">
              <article className="paper">
                <div className="paper-top">
                  <span>ТЕКСТ ДЛЯ РЕЦЕНЗИРОВАНИЯ</span>
                  <span>{String(all.indexOf(active) + 1).padStart(2, '0')}</span>
                </div>
                <DocumentEditor
                  key={selected}
                  record={active}
                  awareness={provider.awareness}
                  onSelect={setSelection}
                  onReady={setEditor}
                />
                <div className="paper-footer">
                  <span>{text.length} знаков с пробелами</span>
                  <span>Простой текст · без форматирования</span>
                </div>
              </article>
              <aside className="discussion">
                <div className="discussion-title">
                  <h2>
                    На полях<span>{comments.length}</span>
                  </h2>
                  <button aria-label="Новый комментарий к выделению" onClick={beginComment}>
                    <Plus size={18} />
                  </button>
                </div>
                <p className="discussion-intro">Точные замечания к конкретным словам.</p>
                <div className="comment-filters">
                  <button
                    className={filter === 'open' ? 'active' : ''}
                    onClick={() => setFilter('open')}
                  >
                    Открытые <span>{unresolved.length}</span>
                  </button>
                  <button
                    className={filter === 'resolved' ? 'active' : ''}
                    onClick={() => setFilter('resolved')}
                  >
                    Решённые <span>{comments.length - unresolved.length}</span>
                  </button>
                  <button
                    title="Комментарии, исходный фрагмент которых удалён"
                    className={filter === 'orphan' ? 'active' : ''}
                    onClick={() => setFilter('orphan')}
                  >
                    Без фрагмента <span>{orphaned.length}</span>
                  </button>
                </div>
                {composer && (
                  <form className="comment-composer" onSubmit={submitComment}>
                    <div className="section-label">
                      НОВОЕ ОБСУЖДЕНИЕ
                      <button
                        type="button"
                        aria-label="Закрыть комментарий"
                        onClick={() => setComposer(false)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <blockquote>
                      {text.slice(selection.start, selection.end).slice(0, 250) ||
                        'Выделение больше не доступно'}
                    </blockquote>
                    <textarea
                      ref={commentInput}
                      aria-label="Новый комментарий"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Что можно улучшить?"
                      maxLength={10000}
                      required
                    />
                    <button type="submit" className="send-button">
                      <Send size={14} />
                      Опубликовать
                    </button>
                  </form>
                )}
                <div className="comment-list">
                  {displayed.map((c) => {
                    const anchor = resolveAnchor(workspace, active, c);
                    const replies = c.get('replies')?.toArray() || [];
                    return (
                      <section
                        className={
                          'comment-card ' +
                          (c.get('resolved') ? 'resolved ' : '') +
                          (focusedComment === c.get('id') ? 'focused' : '')
                        }
                        key={c.get('id')}
                      >
                        <div className="comment-author">
                          <span className="comment-avatar">{initials(c.get('author'))}</span>
                          <div>
                            <strong>{c.get('author')}</strong>
                            <small>
                              {new Date(c.get('createdAt')).toLocaleString('ru', {
                                day: 'numeric',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </small>
                          </div>
                          <button
                            title={
                              c.get('resolved') ? 'Открыть обсуждение снова' : 'Отметить решённым'
                            }
                            aria-label={
                              c.get('resolved') ? 'Открыть обсуждение снова' : 'Отметить решённым'
                            }
                            onClick={() => c.set('resolved', !c.get('resolved'))}
                          >
                            {c.get('resolved') ? <CheckCheck size={17} /> : <Check size={17} />}
                          </button>
                        </div>
                        <button
                          className={'quote ' + (!anchor ? 'orphan' : '')}
                          onClick={() => jump(c)}
                        >
                          <span>{anchor ? 'К ФРАГМЕНТУ' : 'ФРАГМЕНТ УДАЛЁН'}</span>«
                          {c.get('quote').slice(0, 180)}
                          {c.get('quote').length > 180 ? '…' : ''}»
                        </button>
                        <p>{c.get('body')}</p>
                        {replies.map((r: any) => (
                          <div className="reply" key={r.id}>
                            <strong>{r.author}</strong>
                            <p>{r.body}</p>
                          </div>
                        ))}
                        <div className="comment-footer">
                          <button
                            onClick={() => {
                              setFocusedComment(focusedComment === c.get('id') ? '' : c.get('id'));
                              setReply('');
                            }}
                          >
                            {replies.length ? `Ответов: ${replies.length}` : 'Ответить'}
                            <ChevronRight size={12} />
                          </button>
                          <span>
                            {c.get('resolved') ? 'Решено' : anchor ? 'Открыто' : 'Контекст удалён'}
                          </span>
                        </div>
                        {focusedComment === c.get('id') && (
                          <form className="reply-form" onSubmit={(e) => addReply(e, c)}>
                            <textarea
                              aria-label="Ответ на комментарий"
                              placeholder="Ваш ответ…"
                              maxLength={10000}
                              required
                              value={reply}
                              onChange={(e) => setReply(e.target.value)}
                            />
                            <button type="submit" className="send-button">
                              <Send size={13} />
                              Ответить
                            </button>
                          </form>
                        )}
                      </section>
                    );
                  })}
                  {!displayed.length && !composer && (
                    <div className="discussion-empty">
                      <MessageSquare size={28} />
                      <h3>
                        {filter === 'resolved'
                          ? 'Пока нет решённых обсуждений'
                          : filter === 'orphan'
                            ? 'Все фрагменты на месте'
                            : 'Оставьте место для диалога'}
                      </h3>
                      <p>
                        Выделите фрагмент в тексте и нажмите «Обсудить фрагмент». Комментарий
                        останется рядом с ним при правках.
                      </p>
                      <span>Вопросы делают текст точнее.</span>
                    </div>
                  )}
                </div>
                <div className="discussion-note">
                  <Link2 size={15} />
                  <p>
                    Обсуждения привязаны к тексту и перемещаются вместе с ним. Удалённые фрагменты
                    помечаются отдельно.
                  </p>
                </div>
              </aside>
            </div>
            <footer className="statusbar">
              <span>
                <span className="status-dot" />
                {localReady ? 'Изменения записываются в IndexedDB' : 'Открываем хранилище'}
                {lastLocal ? ' · ' + lastLocal : ''}
              </span>
              <span>
                {status === 'connected' && synced ? <Users size={13} /> : <WifiOff size={13} />}{' '}
                {status === 'connected' && synced
                  ? 'Изменения объединяются с комнатой'
                  : 'Канал отключён · повторное подключение автоматически'}
              </span>
            </footer>
          </>
        ) : (
          <div className="welcome">
            <div className="welcome-symbol">¶</div>
            <span className="doc-kicker">МЕСТО ДЛЯ СОВМЕСТНОЙ РАБОТЫ</span>
            <h1>
              Любому тексту
              <br />
              нужен второй взгляд.
            </h1>
            <p>
              Создайте документ, откройте комнату в другом браузере и начните обсуждение. Текст и
              комментарии сохраняются на устройстве.
            </p>
            <button className="send-button" onClick={() => setNewOpen(true)}>
              Создать документ
              <ArrowUpRight size={17} />
            </button>
          </div>
        )}
      </div>
      {newOpen && (
        <Modal labelledBy="new-title" onClose={() => setNewOpen(false)}>
          <section className="modal">
            <button className="close-modal" aria-label="Закрыть" onClick={() => setNewOpen(false)}>
              <X size={20} />
            </button>
            <span className="doc-kicker">ЧИСТЫЙ ЛИСТ</span>
            <h2 id="new-title">Начнём с названия.</h2>
            <p>Документ появится у всех участников комнаты после подключения.</p>
            <form onSubmit={create}>
              <label>
                Название документа
                <input
                  autoFocus
                  required
                  maxLength={200}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="О чём будем писать?"
                />
              </label>
              <button type="submit" className="send-button">
                Создать документ
                <ArrowUpRight size={16} />
              </button>
            </form>
          </section>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
