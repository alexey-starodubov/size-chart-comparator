import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addRow,
  addSupplier,
  addType,
  demoChart,
  emptyChart,
  importRows,
  mapKey,
  METHOD_TEXT,
  normText,
  parseChart,
  removeRow,
  removeSupplier,
  removeType,
  renameSupplier,
  setMapping,
  updateRow,
  type Chart,
  type Method,
  type Row,
} from './core/chart-editor';
import { cardCsv, cardTable, comparisonCsv, fileName, typeTitle } from './core/chart-export';
import { analyze, summarize, type Analysis, type Issue } from './core/measurement-compare';
import { formatMm, formatThreshold, ROUNDING_TEXT, UNIT_SHORT, UNIT_TEXT, type Rounding, type ShowUnit, type Unit } from './core/unit-conversion';
import { useChart, type SaveState } from './ui/useChart';

type View = 'data' | 'map' | 'compare' | 'card';
const VIEWS: [View, string][] = [
  ['data', 'Замеры поставщиков'],
  ['map', 'Сопоставление'],
  ['compare', 'Сравнение'],
  ['card', 'Для карточки товара'],
];
const parse = (): View => {
  const h = location.hash.slice(1);
  return VIEWS.some((v) => v[0] === h) ? (h as View) : 'data';
};
const SAVE_TEXT: Record<SaveState, string> = {
  loading: 'Открываю проект…',
  saved: 'Сохранено в этом браузере',
  saving: 'Сохраняю…',
  error: 'Не удалось сохранить: сохраните файл проекта',
  memory: 'Хранилище браузера недоступно: данные живут до закрытия вкладки, сохраните файл проекта',
};
type Update = (fn: (c: Chart) => Chart, immediate?: boolean) => void;
type Notice = (t: string) => void;
const METHODS = Object.keys(METHOD_TEXT) as Method[];

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const BIG_ROWS = 5000;

function useLagged<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Полный анализ на 36 000 строк занимает около 50 мс. На больших проектах ввод текста (значения,
 * названия, порог) пересчитывается через 250 мс после последней правки, чтобы поле не ждало анализа
 * на каждой букве. Действия (загрузка, добавление и удаление строк, сопоставление, единицы) — сразу.
 */
function useAnalysis(chart: Chart): Analysis {
  const big = chart.rows.length >= BIG_ROWS;
  const s = chart.settings;
  const structural = useMemo(
    () => analyze(chart),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    big ? [chart.rows.length, chart.suppliers, chart.types, chart.mappings, s.rounding, s.thresholdUnit, s.show] : [chart],
  );
  const lagged = useLagged(chart, 250);
  const late = useMemo(() => (big && lagged.updatedAt > structural.updatedAt ? analyze(lagged) : null), [big, lagged, structural]);
  return late ?? structural;
}

export function App() {
  const [view, setView] = useState<View>(parse);
  const { chart, update, state, firstRun } = useChart();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'demo' | 'empty' | null>(null);
  useEffect(() => {
    const h = () => setView(parse());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(t);
  }, [notice]);
  const analysis = useAnalysis(chart);
  const loadDemo = () => (update(() => demoChart(), true), setNotice('Загружено демо: три поставщика, футболка и худи'), setConfirm(null));

  return (
    <div className="app">
      <header className="topbar no-print">
        <div>
          <p className="kicker">Сравнение размерных сеток</p>
          <h1>{VIEWS.find((v) => v[0] === view)?.[1]}</h1>
        </div>
        <p className={`save save--${state}`} role="status" data-testid="save">
          {SAVE_TEXT[state]}
        </p>
      </header>
      <nav className="tabs no-print" aria-label="Разделы">
        {VIEWS.map(([v, label]) => (
          <a key={v} href={`#${v}`} className={`tab ${view === v ? 'tab--on' : ''}`} aria-current={view === v ? 'page' : undefined}>
            {label}
            {v === 'map' && analysis.issues.length ? (
              <span className="tab__badge" aria-label={`неоднозначных строк: ${analysis.issues.length}`}>
                {' '}
                {analysis.issues.length}
              </span>
            ) : null}
          </a>
        ))}
      </nav>
      <p className="notice-line no-print" role="status" aria-live="polite" data-testid="notice">
        {notice ?? ''}
      </p>
      {error ? (
        <p className="errors no-print" role="alert" data-testid="error">
          {error}
        </p>
      ) : null}
      {state === 'loading' ? (
        <p className="muted">Загрузка…</p>
      ) : (
        <>
          {firstRun ? (
            <section className="panel welcome no-print" aria-labelledby="welcome-h">
              <h2 id="welcome-h">С чего начать</h2>
              <p>
                Добавьте поставщика и внесите его замеры (или вставьте таблицу), затем сопоставьте названия замеров с общими типами. Сравнение покажет, где одинаковый размер у разных поставщиков различается больше
                заданного порога.
              </p>
              <button type="button" className="btn btn--primary" onClick={loadDemo}>
                Загрузить демо
              </button>
            </section>
          ) : null}
          {view === 'data' ? (
            <DataView chart={chart} analysis={analysis} update={update} setNotice={setNotice} />
          ) : view === 'map' ? (
            <MapView chart={chart} analysis={analysis} update={update} setNotice={setNotice} />
          ) : view === 'compare' ? (
            <CompareView chart={chart} analysis={analysis} update={update} setNotice={setNotice} />
          ) : (
            <CardView chart={chart} analysis={analysis} setNotice={setNotice} />
          )}
          <section className="panel no-print" aria-labelledby="file-h">
            <h2 id="file-h">Проект целиком</h2>
            <div className="row">
              <button type="button" className="btn" onClick={() => (download('razmernye-setki.json', JSON.stringify(chart, null, 1), 'application/json'), setNotice('Файл razmernye-setki.json сохранён'))}>
                Сохранить проект в файл (.json)
              </button>
              <label className="btn file-btn">
                Открыть проект из файла…
                <input
                  type="file"
                  accept=".json,application/json"
                  className="visually-hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    setError(null);
                    try {
                      const r = parseChart(JSON.parse(await f.text()));
                      if (!r.ok) return setError(`Проект не открыт: ${r.error}`);
                      update(() => r.chart, true);
                      setNotice('Проект открыт из файла');
                    } catch {
                      setError('Проект не открыт: файл не JSON или повреждён');
                    }
                  }}
                />
              </label>
              {confirm ? (
                <>
                  <span>Текущие данные будут заменены.</span>
                  <button
                    type="button"
                    className="btn btn--danger"
                    onClick={() => (confirm === 'demo' ? loadDemo() : (update(() => emptyChart(), true), setNotice('Начат пустой проект'), setConfirm(null)))}
                  >
                    Заменить
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={() => setConfirm(null)}>
                    Отмена
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn--ghost" onClick={() => setConfirm('demo')}>
                    Демо
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={() => setConfirm('empty')}>
                    Пустой проект
                  </button>
                </>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/* ---------------- Замеры поставщиков ---------------- */

const PAGE = 100;

function DataView({ chart, analysis, update, setNotice }: { chart: Chart; analysis: Analysis; update: Update; setNotice: Notice }) {
  const [sid, setSid] = useState(chart.suppliers[0]?.id ?? '');
  const [model, setModel] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const supplier = chart.suppliers.find((s) => s.id === sid) ?? chart.suppliers[0];
  useEffect(() => {
    if (supplier && supplier.id !== sid) setSid(supplier.id);
  }, [supplier, sid]);
  useEffect(() => setLimit(PAGE), [sid, model]);
  const rows = useMemo(() => chart.rows.filter((r) => r.supplierId === supplier?.id), [chart.rows, supplier]);
  const models = useMemo(() => [...new Map(rows.map((r) => [normText(r.model), r.model])).values()], [rows]);
  const shown = model ? rows.filter((r) => normText(r.model) === model) : rows;
  const problems = useMemo(() => {
    const m = new Map<string, Issue>();
    for (const i of analysis.issues) for (const id of i.rowIds) m.set(id, i);
    return m;
  }, [analysis.issues]);
  const firstNew = useRef<number | null>(null);
  useEffect(() => {
    const i = firstNew.current;
    if (i === null) return;
    firstNew.current = null;
    document.querySelectorAll<HTMLInputElement>('[data-testid="row"] input[data-col="value"]')[i]?.focus();
  }, [limit]);

  return (
    <main>
      <SupplierBar chart={chart} supplierId={supplier?.id ?? ''} setSid={setSid} update={update} setNotice={setNotice} />
      {supplier ? (
        <>
          <div className="filters">
            <div className="field">
              <label htmlFor="model-filter">Модель</label>
              <select id="model-filter" value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="">все модели ({rows.length} строк)</option>
                {models.map((m) => (
                  <option key={m} value={normText(m)}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <p className="muted" data-testid="row-count">
              Строк: {shown.length}
              {shown.length > limit ? `, показаны ${limit}` : ''}
            </p>
          </div>
          {shown.length === 0 ? (
            <p className="empty">У поставщика «{supplier.name}» ещё нет строк. Добавьте строку ниже или вставьте таблицу.</p>
          ) : (
            <div className="table-wrap">
              <table className="data cards-sm labeled rows-table">
                <caption className="visually-hidden">Строки замеров поставщика {supplier.name}</caption>
                <thead>
                  <tr>
                    <th scope="col">Модель</th>
                    <th scope="col">Размер</th>
                    <th scope="col">Замер у поставщика</th>
                    <th scope="col">Значение</th>
                    <th scope="col">Единица</th>
                    <th scope="col">
                      <span className="visually-hidden">Действия</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, limit).map((r) => (
                    <RowEdit key={r.id} r={r} issue={problems.get(r.id)} update={update} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {shown.length > limit ? (
            <p>
              <button type="button" className="btn" onClick={() => ((firstNew.current = limit), setLimit(limit + PAGE))}>
                Показать ещё {Math.min(PAGE, shown.length - limit)}
              </button>
            </p>
          ) : null}
          <NewRow chart={chart} supplierId={supplier.id} models={models} update={update} setNotice={setNotice} />
          <ImportRows supplierId={supplier.id} supplierName={supplier.name} update={update} setNotice={setNotice} />
        </>
      ) : null}
    </main>
  );
}

function SupplierBar({ chart, supplierId, setSid, update, setNotice }: { chart: Chart; supplierId: string; setSid: (id: string) => void; update: Update; setNotice: Notice }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  const cur = chart.suppliers.find((s) => s.id === supplierId);
  const add = () => {
    const r = addSupplier(chart, name);
    if ('error' in r) return setErr(r.error);
    update(() => r.chart, true);
    setSid(r.id);
    setName('');
    setErr(null);
    setNotice(`Добавлен поставщик «${r.chart.suppliers.at(-1)!.name}»`);
  };
  return (
    <section className="panel" aria-label="Поставщики">
      <div className="row">
        {chart.suppliers.length ? (
          <div className="field">
            <label htmlFor="supplier">Поставщик</label>
            <select id="supplier" value={supplierId} onChange={(e) => (setSid(e.target.value), setRename(null), setDel(false))}>
              {chart.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {cur && rename === null && !del ? (
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setRename(cur.name)}>
              Переименовать
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setDel(true)}>
              Удалить поставщика
            </button>
          </>
        ) : null}
        {cur && rename !== null ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              const r = renameSupplier(chart, cur.id, rename);
              if ('error' in r) return setErr(r.error);
              update(() => r, true);
              setRename(null);
              setErr(null);
            }}
          >
            <div className="field">
              <label htmlFor="sup-rename">Новое название</label>
              <input id="sup-rename" value={rename} autoFocus onChange={(e) => setRename(e.target.value)} />
            </div>
            <button type="submit" className="btn btn--primary">
              Сохранить
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => (setRename(null), setErr(null))}>
              Отмена
            </button>
          </form>
        ) : null}
        {cur && del ? (
          <>
            <span>
              Удалить «{cur.name}» и его {chart.rows.filter((r) => r.supplierId === cur.id).length} строк?
            </span>
            <button type="button" className="btn btn--danger" onClick={() => (update((c) => removeSupplier(c, cur.id), true), setDel(false), setNotice(`Поставщик «${cur.name}» удалён`))}>
              Удалить
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setDel(false)}>
              Отмена
            </button>
          </>
        ) : null}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <div className={`field field--grow ${err ? 'field--error' : ''}`}>
          <label htmlFor="sup-new">Новый поставщик</label>
          <input id="sup-new" value={name} maxLength={80} onChange={(e) => (setName(e.target.value), setErr(null))} aria-invalid={err ? true : undefined} aria-describedby={err ? 'sup-err' : undefined} />
          {err ? (
            <span className="field__error" id="sup-err">
              {err}
            </span>
          ) : null}
        </div>
        <button type="submit" className="btn">
          Добавить поставщика
        </button>
      </form>
    </section>
  );
}

function RowEdit({ r, issue, update }: { r: Row; issue: Issue | undefined; update: Update }) {
  const name = `${r.model}, ${r.size}, ${r.label}`;
  const set = (patch: Partial<Row>) => update((c) => updateRow(c, r.id, patch));
  const bad = issue?.kind === 'invalid';
  return (
    <tr data-testid="row" data-row={`${r.model} ${r.size} ${r.label}`} className={issue ? 'row--issue' : undefined}>
      <td data-label="Модель">
        <input aria-label={`${name}: модель`} value={r.model} onChange={(e) => set({ model: e.target.value })} />
      </td>
      <td data-label="Размер">
        <input aria-label={`${name}: размер`} className="in-size" value={r.size} onChange={(e) => set({ size: e.target.value })} />
      </td>
      <td data-label="Замер">
        <input aria-label={`${name}: замер`} value={r.label} onChange={(e) => set({ label: e.target.value })} />
        {issue && issue.kind !== 'invalid' ? (
          <a className="issue-link" href="#map">
            {issue.kind === 'unmapped' ? 'тип не сопоставлен' : 'конфликт строк'}
          </a>
        ) : null}
      </td>
      <td data-label="Значение">
        <input
          aria-label={`${name}: значение`}
          data-col="value"
          className="in-value"
          inputMode="decimal"
          value={r.value}
          placeholder="нет данных"
          aria-invalid={bad ? true : undefined}
          aria-describedby={bad ? `err-${r.id}` : undefined}
          onChange={(e) => set({ value: e.target.value })}
        />
        {bad ? (
          <span className="field__error" id={`err-${r.id}`}>
            {issue.message}
          </span>
        ) : null}
      </td>
      <td data-label="Единица">
        <select aria-label={`${name}: единица`} value={r.unit} onChange={(e) => update((c) => updateRow(c, r.id, { unit: e.target.value as Unit }), true)}>
          <option value="cm">см</option>
          <option value="in">дюймы</option>
        </select>
      </td>
      <td>
        <button type="button" className="btn btn--ghost" aria-label={`Удалить строку ${name}`} onClick={() => update((c) => removeRow(c, r.id), true)}>
          Удалить
        </button>
      </td>
    </tr>
  );
}

function NewRow({ chart, supplierId, models, update, setNotice }: { chart: Chart; supplierId: string; models: string[]; update: Update; setNotice: Notice }) {
  const [f, setF] = useState({ model: models[0] ?? '', size: '', label: '', value: '', unit: 'cm' as Unit });
  const [err, setErr] = useState<{ field: string; text: string } | null>(null);
  const sizeRef = useRef<HTMLInputElement>(null);
  const refs = { model: useRef<HTMLInputElement>(null), size: sizeRef, label: useRef<HTMLInputElement>(null) };
  const labels = useMemo(() => [...new Set(chart.rows.filter((r) => r.supplierId === supplierId).map((r) => r.label))], [chart.rows, supplierId]);
  const submit = () => {
    const r = addRow(chart, { supplierId, ...f });
    if ('error' in r) {
      setErr({ field: r.field, text: r.error });
      refs[r.field as 'model' | 'size' | 'label']?.current?.focus();
      return;
    }
    update(() => r.chart, true);
    setNotice(`Строка добавлена: ${f.model.trim()} · ${f.size.trim()} · ${f.label.trim()} · ${f.value.trim() || 'нет данных'}`);
    // Модель, замер и единица обычно повторяются: следующая строка — следующий размер.
    setF({ ...f, size: '', value: '' });
    setErr(null);
    sizeRef.current?.focus();
  };
  const fld = (k: 'model' | 'size' | 'label', label: string, list?: string) => (
    <div className={`field ${k === 'size' ? '' : 'field--grow'} ${err?.field === k ? 'field--error' : ''}`}>
      <label htmlFor={`new-${k}`}>{label}</label>
      <input
        id={`new-${k}`}
        ref={refs[k]}
        list={list}
        value={f[k]}
        maxLength={80}
        aria-invalid={err?.field === k ? true : undefined}
        aria-describedby={err?.field === k ? 'new-err' : undefined}
        onChange={(e) => (setF({ ...f, [k]: e.target.value }), setErr(null))}
      />
      {err?.field === k ? (
        <span className="field__error" id="new-err">
          {err.text}
        </span>
      ) : null}
    </div>
  );
  return (
    <form
      className="panel"
      aria-labelledby="new-row-h"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h2 id="new-row-h">Новая строка</h2>
      <datalist id="dl-models">
        {models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <datalist id="dl-labels">
        {labels.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <div className="row">
        {fld('model', 'Модель', 'dl-models')}
        {fld('size', 'Размер')}
        {fld('label', 'Замер у поставщика', 'dl-labels')}
        <div className="field">
          <label htmlFor="new-value">Значение</label>
          <input id="new-value" inputMode="decimal" value={f.value} placeholder="48,5 или 19 1/2" onChange={(e) => setF({ ...f, value: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="new-unit">Единица</label>
          <select id="new-unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value as Unit })}>
            <option value="cm">см</option>
            <option value="in">дюймы</option>
          </select>
        </div>
        <button type="submit" className="btn btn--primary">
          Добавить строку
        </button>
      </div>
    </form>
  );
}

function ImportRows({ supplierId, supplierName, update, setNotice }: { supplierId: string; supplierName: string; update: Update; setNotice: Notice }) {
  const [text, setText] = useState('');
  const [unit, setUnit] = useState<Unit>('cm');
  const [errors, setErrors] = useState<string[]>([]);
  return (
    <details className="panel">
      <summary>
        <h2 className="summary-h">Вставить таблицу поставщика</h2>
      </summary>
      <p className="hint">
        Столбцы: модель; размер; замер; значение; единица (см или дюймы). Разделитель «;» или табуляция (так копируется из Excel). Строка заголовка необязательна. Пустое значение загрузится как «нет данных».
      </p>
      <div className="field field--wide">
        <label htmlFor="imp-text">Строки для «{supplierName}»</label>
        <textarea id="imp-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Футболка базовая;M;Ширина груди;48;см\nФутболка базовая;L;Ширина груди;;см'} />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="imp-unit">Единица, если не указана</label>
          <select id="imp-unit" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            <option value="cm">см</option>
            <option value="in">дюймы</option>
          </select>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            const r = importRows(text, supplierId, unit);
            setErrors(r.errors);
            if (r.rows.length) update((c) => ({ ...c, rows: [...c.rows, ...r.rows] }), true);
            if (r.rows.length) setText('');
            setNotice(
              r.rows.length
                ? `Загружено строк: ${r.rows.length}${r.missing ? `, без значения (нет данных): ${r.missing}` : ''}${r.errors.length ? `, пропущено с ошибками: ${r.errors.length}` : ''}`
                : 'Ничего не загружено: проверьте столбцы',
            );
          }}
        >
          Загрузить строки
        </button>
      </div>
      {errors.length ? (
        <ul className="errors" data-testid="import-errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

/* ---------------- Сопоставление ---------------- */

function MappingSelects({ chart, supplierId, label, update, prefix }: { chart: Chart; supplierId: string; label: string; update: Update; prefix: string }) {
  const m = chart.mappings[mapKey(supplierId, label)];
  const id = `${prefix}-${supplierId}-${normText(label).replace(/\W+/g, '_')}`;
  const name = `${chart.suppliers.find((s) => s.id === supplierId)?.name}, «${label}»`;
  return (
    <>
      <select
        id={`${id}-t`}
        aria-label={`${name}: тип замера`}
        value={m?.typeId ?? ''}
        onChange={(e) => update((c) => setMapping(c, supplierId, label, e.target.value ? { typeId: e.target.value } : null), true)}
      >
        <option value="">не сопоставлен</option>
        {chart.types.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <select
        aria-label={`${name}: способ измерения`}
        value={m?.method ?? 'flat'}
        disabled={!m}
        onChange={(e) => update((c) => setMapping(c, supplierId, label, { method: e.target.value as Method }), true)}
      >
        {METHODS.map((x) => (
          <option key={x} value={x}>
            {METHOD_TEXT[x]}
          </option>
        ))}
      </select>
    </>
  );
}

function MapView({ chart, analysis, update, setNotice }: { chart: Chart; analysis: Analysis; update: Update; setNotice: Notice }) {
  const [typeName, setTypeName] = useState('');
  const [typeErr, setTypeErr] = useState<string | null>(null);
  const rowsById = useMemo(() => new Map(chart.rows.map((r) => [r.id, r])), [chart.rows]);
  const labels = useMemo(() => {
    const out = new Map<string, { supplierId: string; label: string; count: number }>();
    for (const r of chart.rows) {
      const k = mapKey(r.supplierId, r.label);
      const x = out.get(k);
      if (x) x.count++;
      else out.set(k, { supplierId: r.supplierId, label: r.label.trim(), count: 1 });
    }
    return [...out.values()];
  }, [chart.rows]);
  const unit = (u: Unit) => (u === 'cm' ? 'см' : 'дюйм.');
  return (
    <main>
      <section className="panel" aria-labelledby="issues-h">
        <h2 id="issues-h">Неоднозначные строки: {analysis.issues.length}</h2>
        {analysis.issues.length === 0 ? (
          <p className="ok">Все строки однозначны и участвуют в сравнении.</p>
        ) : (
          <>
            <p className="hint">Эти строки не участвуют в сравнении, пока их не исправить. Остальные строки сравниваются как обычно.</p>
            <ul className="issues">
              {analysis.issues.map((i) => {
                const first = rowsById.get(i.rowIds[0]!)!;
                return (
                  <li key={`${i.kind}-${i.rowIds.join()}`} className="issue" data-testid="issue" data-kind={i.kind}>
                    <p className="issue__text">{i.text}</p>
                    {i.kind === 'unmapped' ? (
                      <div className="row">
                        <MappingSelects chart={chart} supplierId={i.supplierId} label={first.label} update={update} prefix="iss" />
                      </div>
                    ) : i.kind === 'invalid' ? (
                      <div className="row">
                        <div className="field">
                          <label htmlFor={`fix-${first.id}`}>Значение</label>
                          <input id={`fix-${first.id}`} inputMode="decimal" value={first.value} onChange={(e) => update((c) => updateRow(c, first.id, { value: e.target.value }))} />
                        </div>
                      </div>
                    ) : (
                      <ul className="conflict-rows">
                        {i.rowIds.map((id) => {
                          const r = rowsById.get(id)!;
                          return (
                            <li key={id}>
                              «{r.label}» = {r.value ? `${r.value} ${unit(r.unit)}` : 'нет данных'}{' '}
                              <button
                                type="button"
                                className="btn btn--ghost"
                                onClick={() => (update((c) => removeRow(c, id), true), setNotice(`Строка «${r.label}» = ${r.value || 'нет данных'} удалена`))}
                                aria-label={`Удалить строку ${r.model} ${r.size} «${r.label}» = ${r.value || 'нет данных'}`}
                              >
                                Удалить эту строку
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section className="panel" aria-labelledby="maps-h">
        <h2 id="maps-h">Названия замеров у поставщиков</h2>
        <p className="hint">Сравниваются только строки с одинаковым типом и способом измерения: ширина «по плоскости» (полуобхват) и «по обхвату» — разные величины.</p>
        {labels.length === 0 ? (
          <p className="empty">Строк ещё нет.</p>
        ) : (
          <table className="data cards-sm">
            <thead>
              <tr>
                <th scope="col">Поставщик</th>
                <th scope="col">Замер у поставщика</th>
                <th scope="col">Строк</th>
                <th scope="col">Тип и способ</th>
              </tr>
            </thead>
            <tbody>
              {labels.map((l) => (
                <tr key={mapKey(l.supplierId, l.label)} data-testid="mapping" data-label={l.label}>
                  <td>{chart.suppliers.find((s) => s.id === l.supplierId)?.name}</td>
                  <td>{l.label}</td>
                  <td>{l.count}</td>
                  <td className="map-cell">
                    <MappingSelects chart={chart} supplierId={l.supplierId} label={l.label} update={update} prefix="map" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel" aria-labelledby="types-h">
        <h2 id="types-h">Общие типы замеров</h2>
        <ul className="types">
          {chart.types.map((t) => (
            <li key={t.id}>
              {t.name}{' '}
              <button type="button" className="btn btn--ghost" aria-label={`Удалить тип «${t.name}»`} onClick={() => (update((c) => removeType(c, t.id), true), setNotice(`Тип «${t.name}» удалён, его сопоставления сняты`))}>
                Удалить
              </button>
            </li>
          ))}
        </ul>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            const r = addType(chart, typeName);
            if ('error' in r) return setTypeErr(r.error);
            update(() => r.chart, true);
            setTypeName('');
            setTypeErr(null);
          }}
        >
          <div className={`field ${typeErr ? 'field--error' : ''}`}>
            <label htmlFor="type-new">Новый тип</label>
            <input id="type-new" value={typeName} maxLength={60} onChange={(e) => (setTypeName(e.target.value), setTypeErr(null))} aria-invalid={typeErr ? true : undefined} aria-describedby={typeErr ? 'type-err' : undefined} />
            {typeErr ? (
              <span className="field__error" id="type-err">
                {typeErr}
              </span>
            ) : null}
          </div>
          <button type="submit" className="btn">
            Добавить тип
          </button>
        </form>
      </section>
    </main>
  );
}

/* ---------------- Сравнение ---------------- */

function CompareView({ chart, analysis, update, setNotice }: { chart: Chart; analysis: Analysis; update: Update; setNotice: Notice }) {
  const s = chart.settings;
  const [model, setModel] = useState('');
  const [onlyOver, setOnlyOver] = useState(false);
  const models = analysis.models;
  const cur = models.find((m) => normText(m) === model) ?? models[0];
  const sup = cur ? (analysis.suppliersByModel[normText(cur)] ?? []) : [];
  const groups = analysis.groups.filter((g) => cur && normText(g.model) === normText(cur));
  const shown = onlyOver ? groups.filter((g) => g.over) : groups;
  const sum = summarize(groups, sup);
  const setS = (patch: Partial<Chart['settings']>, immediate = true) => update((c) => ({ ...c, settings: { ...c.settings, ...patch } }), immediate);
  const names = Object.fromEntries(chart.suppliers.map((x) => [x.id, x.name]));
  const show = s.show;
  return (
    <main>
      <section className="panel" aria-label="Настройки сравнения">
        <div className="row">
          <div className={`field ${analysis.threshold ? '' : 'field--error'}`}>
            <label htmlFor="thr">Порог расхождения</label>
            <input id="thr" inputMode="decimal" value={s.threshold} onChange={(e) => setS({ threshold: e.target.value }, false)} aria-invalid={analysis.threshold ? undefined : true} aria-describedby={analysis.threshold ? undefined : 'thr-err'} />
            {analysis.threshold ? null : (
              <span className="field__error" id="thr-err">
                Порог — число, например 2 или 0,5
              </span>
            )}
          </div>
          <div className="field">
            <label htmlFor="thr-unit">Единица порога</label>
            <select id="thr-unit" value={s.thresholdUnit} onChange={(e) => setS({ thresholdUnit: e.target.value as Unit })}>
              <option value="cm">см</option>
              <option value="in">дюймы</option>
            </select>
          </div>
          <div className="field field--md">
            <label htmlFor="rounding">Округление до целых мм</label>
            <select id="rounding" value={s.rounding} onChange={(e) => setS({ rounding: e.target.value as Rounding })}>
              {(Object.keys(ROUNDING_TEXT) as Rounding[]).map((r) => (
                <option key={r} value={r}>
                  {ROUNDING_TEXT[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="show">Показывать в</label>
            <select id="show" value={show} onChange={(e) => setS({ show: e.target.value as ShowUnit })}>
              {(['cm', 'in', 'mm'] as ShowUnit[]).map((u) => (
                <option key={u} value={u}>
                  {UNIT_TEXT[u]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>
      {analysis.issues.length ? (
        <p className="banner" data-testid="issues-banner">
          Неоднозначных строк: {analysis.issues.length}. Они не участвуют в сравнении. <a href="#map">Исправить</a>
        </p>
      ) : null}
      {!cur ? (
        <p className="empty">Нет данных для сравнения: добавьте строки замеров.</p>
      ) : (
        <>
          <div className="filters">
            <div className="field">
              <label htmlFor="cmp-model">Модель</label>
              <select id="cmp-model" value={normText(cur)} onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => (
                  <option key={m} value={normText(m)}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <label className="check">
              <input type="checkbox" checked={onlyOver} onChange={(e) => setOnlyOver(e.target.checked)} /> Только больше порога
            </label>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const name = fileName(`sravnenie ${cur}`, 'csv');
                download(name, comparisonCsv(chart, analysis, groups), 'text/csv;charset=utf-8');
                setNotice(`Файл ${name} сохранён`);
              }}
            >
              Скачать CSV сравнения
            </button>
          </div>
          <p className="muted" data-testid="summary">
            Строк сравнения: {sum.groups}, больше порога {formatThreshold(analysis.settings.threshold, analysis.settings.thresholdUnit)}: {sum.over}, с пропусками: {sum.incomplete}. Значения в{' '}
            {UNIT_TEXT[show] === 'дюймы' ? 'дюймах' : UNIT_SHORT[show]}, округление {ROUNDING_TEXT[analysis.settings.rounding]}.
          </p>
          <div className="table-wrap">
            <table className="data compare cards-sm labeled">
              <caption className="visually-hidden">Сравнение замеров модели {cur}</caption>
              <thead>
                <tr>
                  <th scope="col">Размер</th>
                  <th scope="col">Замер</th>
                  {sup.map((id) => (
                    <th key={id} scope="col">
                      {names[id]}, {UNIT_SHORT[show]}
                    </th>
                  ))}
                  <th scope="col">Разброс, {UNIT_SHORT[show]}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((g) => (
                  <tr key={g.key} className={g.over ? 'row--over' : undefined} data-testid="cmp" data-cmp={`${g.size} ${chart.types.find((t) => t.id === g.typeId)?.name}`}>
                    <th scope="row" data-label="Размер">
                      {g.size}
                    </th>
                    <td data-label="Замер">
                      <span>
                        {chart.types.find((t) => t.id === g.typeId)?.name} <span className="muted small">({METHOD_TEXT[g.method]})</span>
                      </span>
                    </td>
                    {sup.map((id) => {
                      const c = g.cells[id];
                      return (
                        <td key={id} className={!c || c.kind !== 'value' ? 'cell--gap' : undefined} data-label={`${names[id]}, ${UNIT_SHORT[show]}`}>
                          {!c || c.kind === 'missing' ? <span className="muted">нет данных</span> : c.kind === 'conflict' ? <a href="#map">конфликт строк</a> : formatMm(c.mm, show)}
                        </td>
                      );
                    })}
                    <td data-testid="spread" data-label={`Разброс, ${UNIT_SHORT[show]}`}>
                      {g.spread === null ? (
                        <span className="muted">мало данных</span>
                      ) : g.over ? (
                        <strong>{formatMm(g.spread, show)} — больше порога</strong>
                      ) : (
                        formatMm(g.spread, show)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length === 0 ? <p className="empty">Нет строк больше порога.</p> : null}
        </>
      )}
    </main>
  );
}

/* ---------------- Для карточки товара ---------------- */

function CardView({ chart, analysis, setNotice }: { chart: Chart; analysis: Analysis; setNotice: Notice }) {
  const [model, setModel] = useState('');
  const [sid, setSid] = useState('');
  const [show, setShow] = useState<ShowUnit>(chart.settings.show === 'mm' ? 'cm' : chart.settings.show);
  const cur = analysis.models.find((m) => normText(m) === model) ?? analysis.models[0];
  const sups = cur ? (analysis.suppliersByModel[normText(cur)] ?? []) : [];
  const supplierId = sups.includes(sid) ? sid : sups[0];
  const supplier = chart.suppliers.find((s) => s.id === supplierId);
  const table = useMemo(() => (cur && supplierId ? cardTable(chart, analysis, cur, supplierId, show) : null), [chart, analysis, cur, supplierId, show]);
  if (!cur || !supplier || !table) return <p className="empty">Нет данных: добавьте строки замеров.</p>;
  const issues = analysis.issues.filter((i) => i.supplierId === supplier.id).length;
  return (
    <main>
      <div className="filters no-print">
        <div className="field">
          <label htmlFor="card-model">Модель</label>
          <select id="card-model" value={normText(cur)} onChange={(e) => setModel(e.target.value)}>
            {analysis.models.map((m) => (
              <option key={m} value={normText(m)}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="card-sup">Поставщик</label>
          <select id="card-sup" value={supplier.id} onChange={(e) => setSid(e.target.value)}>
            {sups.map((id) => (
              <option key={id} value={id}>
                {chart.suppliers.find((s) => s.id === id)?.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="card-unit">Единица</label>
          <select id="card-unit" value={show} onChange={(e) => setShow(e.target.value as ShowUnit)}>
            {(['cm', 'in', 'mm'] as ShowUnit[]).map((u) => (
              <option key={u} value={u}>
                {UNIT_TEXT[u]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => {
            const name = fileName(`${cur} ${supplier.name}`, 'csv');
            download(name, cardCsv(table), 'text/csv;charset=utf-8');
            setNotice(`Файл ${name} сохранён`);
          }}
        >
          Скачать CSV
        </button>
        <button type="button" className="btn" onClick={() => window.print()}>
          Печать
        </button>
      </div>
      {issues ? (
        <p className="banner no-print">
          У этого поставщика неоднозначных строк: {issues}. В таблицу они не попали. <a href="#map">Исправить</a>
        </p>
      ) : null}
      <section className="print-area" aria-labelledby="card-h">
        <h2 id="card-h">
          {cur}: замеры изделия, {UNIT_SHORT[show]}
        </h2>
        <p className="muted small">
          Поставщик: {supplier.name}. Замеры готового изделия, способ указан в заголовке столбца. Значения округлены {ROUNDING_TEXT[chart.settings.rounding]}.
        </p>
        {table.rows.length === 0 ? (
          <p className="empty">Нет однозначных строк для этой модели у поставщика.</p>
        ) : (
          <div className="table-wrap">
            <table className="data card-table cards-sm labeled" data-testid="card-table">
              <thead>
                <tr>
                  <th scope="col">Размер</th>
                  {table.columns.map((c) => (
                    <th key={`${c.typeId}|${c.method}`} scope="col">
                      {typeTitle(chart, c.typeId, c.method, show)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r) => (
                  <tr key={r.size}>
                    <th scope="row" data-label="Размер">
                      {r.size}
                    </th>
                    {r.cells.map((x, i) => (
                      <td key={i} className={x === 'нет данных' ? 'muted' : undefined} data-label={table.columns[i]!.title}>
                        {x}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
