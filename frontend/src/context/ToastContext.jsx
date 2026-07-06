import { createContext, useCallback, useContext, useRef, useState } from 'react';

const ToastContext = createContext(null);

let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const showToast = useCallback((message, type = 'info', duration = 5000) => {
    const id = nextId++;
    setToasts((t) => [...t, { id, message, type }]);
    timers.current.set(id, setTimeout(() => dismiss(id), duration));
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto w-full max-w-sm rounded-md border px-4 py-3 text-sm shadow-lg"
            style={{
              backgroundColor: t.type === 'error' ? 'color-mix(in srgb, var(--color-danger) 12%, var(--color-card))' : 'var(--color-card)',
              borderColor: t.type === 'error' ? 'var(--color-danger)' : 'var(--color-border)',
              color: 'var(--color-text-primary)',
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <span>{t.message}</span>
              <button onClick={() => dismiss(t.id)} className="flex-shrink-0 text-xs opacity-60 hover:opacity-100">✕</button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
