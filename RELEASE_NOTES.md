# 0.1.0-rc.1 — 18 октября 2026

- Реальная общая редакционная комната: несколько документов, названия, архив/восстановление.
- Yjs + CodeMirror: конкурентные правки, локальный undo/redo, удалённые курсоры и присутствие.
- Комментарии к диапазонам, ответы, resolve/reopen, отдельный фильтр потерянных фрагментов.
- y-indexeddb offline persistence, reconnect convergence, production offline shell.
- Node WebSocket relay совместимого протокола, дисковый snapshot и graceful shutdown.
- TXT и JSON-экспорт. Ошибки канала показываются без удаления локального текста.
- Самостоятельная бумажная/терракотовая визуальная система, адаптивный review интерфейс.

Автоматические проверки: три meaningful domain/integration tests, включая два реальных WS-клиента, awareness, reconnect и рестарт. TypeScript/Vite build проходит; chunks редактора и collaboration выделены отдельно. Browser-приёмка выполняется дополнительно; нет неподтверждённых throughput/security заявлений.
