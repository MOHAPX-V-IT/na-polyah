import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import * as Y from 'yjs';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import type { Awareness } from 'y-protocols/awareness';
export type EditorHandle = { view: EditorView; undo: Y.UndoManager };
export function DocumentEditor({
  record,
  awareness,
  onSelect,
  onReady,
}: {
  record: Y.Map<unknown>;
  awareness: Awareness;
  onSelect: (s: { start: number; end: number }) => void;
  onReady: (h: EditorHandle | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const text = record.get('body') as Y.Text;
    const undo = new Y.UndoManager(text);
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: text.toString(),
        extensions: [
          keymap.of([...yUndoManagerKeymap, ...defaultKeymap]),
          EditorView.lineWrapping,
          placeholder('Начните писать здесь…'),
          yCollab(text, awareness, { undoManager: undo }),
          EditorView.contentAttributes.of({ 'aria-label': 'Текст документа', spellcheck: 'true' }),
          EditorView.updateListener.of((update) => {
            if (update.selectionSet || update.docChanged) {
              const range = update.state.selection.main;
              onSelect({ start: range.from, end: range.to });
            }
          }),
          EditorView.theme({
            '&': { height: '100%', fontSize: '17px' },
            '.cm-content': {
              fontFamily: 'Georgia, serif',
              lineHeight: '1.95',
              padding: '6px 0 160px',
              minHeight: '480px',
            },
            '.cm-line': { padding: '0' },
            '.cm-scroller': { overflow: 'visible' },
            '&.cm-focused': { outline: 'none' },
            '.cm-cursor': { borderLeftColor: '#a85035' },
            '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
              background: '#e5d9c8',
            },
          }),
        ],
      }),
    });
    onReady({ view, undo });
    return () => {
      onReady(null);
      view.destroy();
      undo.destroy();
    };
  }, [record, awareness, onSelect, onReady]);
  return <div className="editor-content" ref={host} />;
}
