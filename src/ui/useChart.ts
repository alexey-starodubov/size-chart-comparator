import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyChart, type Chart } from '../core/chart-editor';
import { BACKUP_KEY, IdbStore, MemoryStore, newer, type ChartStore } from '../core/store';

export type SaveState = 'loading' | 'saved' | 'saving' | 'error' | 'memory';

function local(): Storage | null {
  try {
    const s = window.localStorage;
    s.getItem('scc.probe');
    return s;
  } catch {
    return null;
  }
}

/** Проект: IndexedDB, правки полей — через 300 мс, действия — сразу, копия в localStorage на pagehide. */
export function useChart() {
  const [chart, setChart] = useState<Chart>(emptyChart);
  const [state, setState] = useState<SaveState>('loading');
  const [firstRun, setFirstRun] = useState(false);
  const store = useRef<ChartStore | null>(null);
  const latest = useRef(chart);
  const dirty = useRef(false);
  const memory = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    chain.current = chain.current.then(async () => {
      if (!store.current) return;
      if (!dirty.current) {
        setState(memory.current ? 'memory' : 'saved');
        return;
      }
      const snap = latest.current;
      try {
        await store.current.save(snap);
        if (latest.current === snap) {
          dirty.current = false;
          try {
            local()?.removeItem(BACKUP_KEY);
          } catch {
            /* ignore */
          }
          setState(memory.current ? 'memory' : 'saved');
        }
      } catch {
        setState('error');
      }
    });
    return chain.current;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      let s: ChartStore = new IdbStore();
      let loaded: Chart | null = null;
      try {
        loaded = await s.load();
      } catch {
        s = new MemoryStore();
        memory.current = true;
      }
      if (!alive) return;
      store.current = s;
      const pick = newer(loaded, local()?.getItem(BACKUP_KEY) ?? null);
      if (pick.chart) {
        latest.current = pick.chart;
        setChart(pick.chart);
        if (pick.fromBackup) {
          dirty.current = true;
          void flush();
        }
      } else setFirstRun(true);
      setState(memory.current ? 'memory' : 'saved');
    })();
    const away = () => {
      if (!dirty.current) return;
      try {
        local()?.setItem(BACKUP_KEY, JSON.stringify(latest.current));
      } catch {
        /* нет места */
      }
      void flush();
    };
    const vis = () => document.visibilityState === 'hidden' && away();
    window.addEventListener('pagehide', away);
    document.addEventListener('visibilitychange', vis);
    return () => {
      alive = false;
      window.removeEventListener('pagehide', away);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [flush]);

  const update = useCallback(
    (fn: (p: Chart) => Chart, immediate = false) => {
      // Следующее состояние считается от latest до setState: иначе ранний flush записал бы версию до правки.
      const next = { ...fn(latest.current), updatedAt: Date.now() };
      latest.current = next;
      setChart(next);
      dirty.current = true;
      setFirstRun(false);
      setState((s) => (s === 'memory' ? s : 'saving'));
      window.clearTimeout(timer.current);
      if (immediate) queueMicrotask(() => void flush());
      else timer.current = window.setTimeout(() => void flush(), 300);
    },
    [flush],
  );
  return { chart, update, state, firstRun };
}
