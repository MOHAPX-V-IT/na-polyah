import * as Y from 'yjs';
export function createDocument(
  workspace,
  title = 'Новый документ',
  body = '',
  id = crypto.randomUUID(),
) {
  const docs = workspace.getMap('documents');
  const record = new Y.Map();
  workspace.transact(() => {
    docs.set(id, record);
    record.set('id', id);
    record.set('title', new Y.Text(title));
    record.set('body', new Y.Text(body));
    record.set('comments', new Y.Array());
    record.set('createdAt', new Date().toISOString());
    record.set('archived', false);
  });
  return record;
}
export function addComment(workspace, record, start, end, body, author) {
  const text = record.get('body');
  if (!body.trim()) throw new Error('Введите комментарий');
  if (start < 0 || end > text.length || end <= start) throw new Error('Выделите фрагмент текста');
  const comment = new Y.Map();
  workspace.transact(() => {
    record.get('comments').push([comment]);
    comment.set('id', crypto.randomUUID());
    comment.set('body', body.trim());
    comment.set('author', author);
    comment.set('createdAt', new Date().toISOString());
    comment.set('resolved', false);
    comment.set('replies', new Y.Array());
    comment.set('quote', text.toString().slice(start, end));
    comment.set(
      'start',
      JSON.parse(
        JSON.stringify(
          Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, start, 0)),
        ),
      ),
    );
    comment.set(
      'end',
      JSON.parse(
        JSON.stringify(
          Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, end, -1)),
        ),
      ),
    );
  });
  return comment;
}
export function resolveAnchor(workspace, record, comment) {
  try {
    const text = record.get('body');
    const a = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(comment.get('start')),
      workspace,
    );
    const b = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(comment.get('end')),
      workspace,
    );
    if (!a || !b || a.type !== text || b.type !== text || b.index <= a.index) return null;
    return { start: a.index, end: b.index, text: text.toString().slice(a.index, b.index) };
  } catch {
    return null;
  }
}
export function exportDocument(workspace, record) {
  return {
    id: record.get('id'),
    title: record.get('title').toString(),
    text: record.get('body').toString(),
    createdAt: record.get('createdAt'),
    exportedAt: new Date().toISOString(),
    comments: record
      .get('comments')
      .toArray()
      .map((comment) => ({
        ...comment.toJSON(),
        anchor: resolveAnchor(workspace, record, comment),
      })),
  };
}
export function seed(workspace) {
  if (!workspace.getMap('documents').size)
    createDocument(
      workspace,
      'Слово за редактором',
      'Хороший текст рождается в диалоге.\n\nЗдесь можно вместе редактировать документ, обсуждать точные формулировки и сохранять контекст решений. Выделите фрагмент и оставьте первый комментарий на полях.\n\nКогда сеть пропадает, работа продолжается. Изменения сохраняются на устройстве и объединяются после подключения.\n\nОткройте эту страницу в другом браузере или профиле — вы увидите настоящего соавтора и его курсор.',
      'welcome',
    );
}
