/** Данные редактора: поставщики, строки замеров, канонические типы и сопоставление названий поставщиков. */
import type { Rounding, ShowUnit, Unit } from './unit-conversion';

export type Method = 'flat' | 'girth' | 'length';
export const METHOD_TEXT: Record<Method, string> = { flat: 'по плоскости', girth: 'по обхвату', length: 'по длине' };

export interface Supplier {
  id: string;
  name: string;
}
/** Канонический тип замера: «Грудь», «Длина изделия». Способ измерения задаётся при сопоставлении. */
export interface MeasureType {
  id: string;
  name: string;
}
export interface Mapping {
  typeId: string;
  method: Method;
}
/** Строка таблицы поставщика как есть: название замера у поставщика, значение строкой, единица. */
export interface Row {
  id: string;
  supplierId: string;
  model: string;
  size: string;
  label: string;
  value: string;
  unit: Unit;
}
export interface Settings {
  threshold: string;
  thresholdUnit: Unit;
  rounding: Rounding;
  show: ShowUnit;
}
export interface Chart {
  version: 1;
  updatedAt: number;
  suppliers: Supplier[];
  types: MeasureType[];
  /** Ключ — mapKey(поставщик, название замера). */
  mappings: Record<string, Mapping>;
  rows: Row[];
  settings: Settings;
}

let seq = 0;
export const newId = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const space = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Кэш нормализации: на десятках тысяч строк одни и те же модели, размеры и названия повторяются. */
function cached(fn: (s: string) => string): (s: string) => string {
  const m = new Map<string, string>();
  return (s) => {
    let v = m.get(s);
    if (v === undefined) {
      if (m.size > 100_000) m.clear();
      v = fn(s);
      m.set(s, v);
    }
    return v;
  };
}
/** Модель и название замера: регистр, ё/е и лишние пробелы не различаются. */
export const normText = cached((s) => space(s).toLocaleLowerCase('ru').replaceAll('ё', 'е'));

// Поставщики пишут размеры то латиницей, то кириллицей: «М» и «M», «ХL» и «XL» — один размер.
const HOMO: Record<string, string> = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X' };
export const normSize = cached((s: string): string => {
  let x = space(s).toUpperCase().replace(/\s+/g, '');
  x = [...x].map((c) => HOMO[c] ?? c).join('');
  const m = x.match(/^([2-5])XL$/);
  if (m) x = m[1] === '2' ? 'XXL' : m[1] === '3' ? 'XXXL' : x;
  return x;
});
export const mapKey = (supplierId: string, label: string) => `${supplierId}\u0000${normText(label)}`;

const LETTERS = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '4XL', '5XL'];
const rankCache = new Map<string, [number, number, string]>();
/** Ключ сортировки размера (кэшируется): буквенные по росту, затем числовые по числу, затем остальные. */
export function sizeRank(s: string): [number, number, string] {
  let r = rankCache.get(s);
  if (!r) {
    const n = normSize(s);
    const i = LETTERS.indexOf(n);
    const num = n.match(/^\d+(?:[.,]\d+)?/);
    r = i >= 0 ? [0, i, n] : num ? [1, Number(num[0].replace(',', '.')), n] : [2, 0, n];
    if (rankCache.size > 10_000) rankCache.clear();
    rankCache.set(s, r);
  }
  return r;
}
/** Порядок размеров: буквенные по росту, затем числовые по числу, затем остальные по алфавиту. */
export function sizeCompare(a: string, b: string): number {
  const [x, y] = [sizeRank(a), sizeRank(b)];
  return x[0] - y[0] || x[1] - y[1] || (x[2] === y[2] ? 0 : x[2].localeCompare(y[2], 'ru'));
}

export const DEFAULT_SETTINGS: Settings = { threshold: '2', thresholdUnit: 'cm', rounding: 'nearest', show: 'cm' };

export const emptyChart = (): Chart => ({
  version: 1,
  updatedAt: 0,
  suppliers: [],
  types: [
    { id: 't-chest', name: 'Грудь' },
    { id: 't-waist', name: 'Талия' },
    { id: 't-length', name: 'Длина изделия' },
    { id: 't-sleeve', name: 'Рукав' },
  ],
  mappings: {},
  rows: [],
  settings: { ...DEFAULT_SETTINGS },
});

// ---------- правки ----------

export function addSupplier(c: Chart, name: string): { chart: Chart; id: string } | { error: string } {
  const n = space(name);
  if (!n) return { error: 'Введите название поставщика' };
  if (c.suppliers.some((s) => normText(s.name) === normText(n))) return { error: `Поставщик «${n}» уже есть` };
  const id = newId('s');
  return { chart: { ...c, suppliers: [...c.suppliers, { id, name: n }] }, id };
}

export function renameSupplier(c: Chart, id: string, name: string): Chart | { error: string } {
  const n = space(name);
  if (!n) return { error: 'Введите название поставщика' };
  if (c.suppliers.some((s) => s.id !== id && normText(s.name) === normText(n))) return { error: `Поставщик «${n}» уже есть` };
  return { ...c, suppliers: c.suppliers.map((s) => (s.id === id ? { ...s, name: n } : s)) };
}

export function removeSupplier(c: Chart, id: string): Chart {
  const mappings = Object.fromEntries(Object.entries(c.mappings).filter(([k]) => !k.startsWith(`${id}\u0000`)));
  return { ...c, suppliers: c.suppliers.filter((s) => s.id !== id), rows: c.rows.filter((r) => r.supplierId !== id), mappings };
}

export function addRow(c: Chart, r: Omit<Row, 'id'>): { chart: Chart; id: string } | { error: string; field: keyof Row } {
  if (!space(r.model)) return { error: 'Укажите модель', field: 'model' };
  if (!space(r.size)) return { error: 'Укажите размер', field: 'size' };
  if (!space(r.label)) return { error: 'Укажите замер', field: 'label' };
  const id = newId('r');
  const row: Row = { ...r, id, model: space(r.model), size: space(r.size), label: space(r.label), value: r.value.trim() };
  return { chart: { ...c, rows: [...c.rows, row] }, id };
}

export const updateRow = (c: Chart, id: string, patch: Partial<Omit<Row, 'id' | 'supplierId'>>): Chart => ({
  ...c,
  rows: c.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
});

export const removeRow = (c: Chart, id: string): Chart => ({ ...c, rows: c.rows.filter((r) => r.id !== id) });

export function setMapping(c: Chart, supplierId: string, label: string, m: Partial<Mapping> | null): Chart {
  const k = mapKey(supplierId, label);
  const mappings = { ...c.mappings };
  if (m === null) delete mappings[k];
  else mappings[k] = { typeId: m.typeId ?? mappings[k]?.typeId ?? '', method: m.method ?? mappings[k]?.method ?? 'flat' };
  return { ...c, mappings };
}

export function addType(c: Chart, name: string): { chart: Chart; id: string } | { error: string } {
  const n = space(name);
  if (!n) return { error: 'Введите название типа замера' };
  if (c.types.some((t) => normText(t.name) === normText(n))) return { error: `Тип «${n}» уже есть` };
  const id = newId('t');
  return { chart: { ...c, types: [...c.types, { id, name: n }] }, id };
}

/** Удаление типа снимает сопоставления на него: эти строки снова попадут в неоднозначные. */
export function removeType(c: Chart, id: string): Chart {
  return { ...c, types: c.types.filter((t) => t.id !== id), mappings: Object.fromEntries(Object.entries(c.mappings).filter(([, m]) => m.typeId !== id)) };
}

// ---------- загрузка таблицы поставщика ----------

export interface ImportResult {
  rows: Row[];
  missing: number;
  errors: string[];
}

const UNIT_WORDS: Record<string, Unit> = { см: 'cm', cm: 'cm', дюйм: 'in', дюймы: 'in', дюймов: 'in', in: 'in', inch: 'in', '"': 'in' };

/**
 * Вставленная таблица: «Модель;Размер;Замер;Значение;Единица», разделитель «;» или табуляция,
 * строка заголовка необязательна. Пустое значение сохраняется как «нет данных». Строка без модели,
 * размера или замера пропускается с номером в отчёте, остальные загружаются.
 */
export function importRows(text: string, supplierId: string, defaultUnit: Unit): ImportResult {
  const out: ImportResult = { rows: [], missing: 0, errors: [] };
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const cols = line.split(line.includes('\t') ? '\t' : ';').map((x) => x.trim().replace(/^"(.*)"$/, '$1'));
    if (i === 0 && /модель|model/i.test(cols[0] ?? '')) return;
    const [model = '', size = '', label = '', value = '', unitRaw = ''] = cols;
    const where = `строка ${i + 1}`;
    if (!model || !size || !label) {
      out.errors.push(`${where}: нужны модель, размер и замер`);
      return;
    }
    const unit = unitRaw ? UNIT_WORDS[unitRaw.toLowerCase().replace(/\.$/, '')] : defaultUnit;
    if (!unit) {
      out.errors.push(`${where}: неизвестная единица «${unitRaw}» (см или дюймы)`);
      return;
    }
    if (!value) out.missing++;
    out.rows.push({ id: newId('r'), supplierId, model: space(model), size: space(size), label: space(label), value, unit });
  });
  return out;
}

// ---------- файл проекта ----------

export type ParseResult = { ok: true; chart: Chart } | { ok: false; error: string };

/** Проверка файла проекта и данных из хранилища: битые записи не должны ломать приложение. */
export function parseChart(raw: unknown): ParseResult {
  const bad = (error: string): ParseResult => ({ ok: false, error });
  if (!raw || typeof raw !== 'object') return bad('Это не файл проекта');
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return bad('Неизвестная версия файла проекта');
  const str = (x: unknown) => typeof x === 'string';
  if (!Array.isArray(o.suppliers) || !o.suppliers.every((s) => s && str(s.id) && str(s.name))) return bad('Повреждён список поставщиков');
  if (!Array.isArray(o.types) || !o.types.every((t) => t && str(t.id) && str(t.name))) return bad('Повреждён список типов замеров');
  if (!Array.isArray(o.rows)) return bad('Повреждены строки замеров');
  const sup = new Set((o.suppliers as Supplier[]).map((s) => s.id));
  for (const r of o.rows as Row[]) {
    if (!r || ![r.id, r.supplierId, r.model, r.size, r.label, r.value].every(str) || (r.unit !== 'cm' && r.unit !== 'in')) return bad('Повреждена строка замеров');
    if (!sup.has(r.supplierId)) return bad(`Строка ${r.model} ${r.size} ссылается на неизвестного поставщика`);
  }
  const maps: Record<string, Mapping> = {};
  if (o.mappings && typeof o.mappings === 'object') {
    for (const [k, m] of Object.entries(o.mappings as Record<string, Mapping>)) {
      if (m && str(m.typeId) && (m.method === 'flat' || m.method === 'girth' || m.method === 'length')) maps[k] = { typeId: m.typeId, method: m.method };
    }
  }
  const s = (o.settings ?? {}) as Partial<Settings>;
  const settings: Settings = {
    threshold: str(s.threshold) ? (s.threshold as string) : DEFAULT_SETTINGS.threshold,
    thresholdUnit: s.thresholdUnit === 'in' ? 'in' : 'cm',
    rounding: s.rounding === 'down' || s.rounding === 'up' ? s.rounding : 'nearest',
    show: s.show === 'in' || s.show === 'mm' ? s.show : 'cm',
  };
  return {
    ok: true,
    chart: {
      version: 1,
      updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : 0,
      suppliers: o.suppliers as Supplier[],
      types: o.types as MeasureType[],
      mappings: maps,
      rows: o.rows as Row[],
      settings,
    },
  };
}

// ---------- демо ----------

/**
 * Три вымышленных поставщика одной футболки и худи. Приёмка ТЗ: M, грудь 48 и 52 см — расхождение 4 см
 * при пороге 2 см. Длина L 70 и 72 см — ровно на пороге, не подсвечивается. Третий поставщик пишет
 * в дюймах и кириллической «М», у него нет длины рукава для M. У второго — две строки на L/грудь
 * (конфликт) и несопоставленный замер «Обхват бёдер».
 */
export function demoChart(): Chart {
  const c = emptyChart();
  const A = 's-north';
  const B = 's-south';
  const C = 's-knit';
  c.suppliers = [
    { id: A, name: 'Ткани Севера' },
    { id: B, name: 'Хлопок-Юг' },
    { id: C, name: 'Вязальщик' },
  ];
  const row = (s: string, model: string, size: string, label: string, value: string, unit: Unit = 'cm'): Row => ({ id: newId('r'), supplierId: s, model, size, label, value, unit });
  const T = 'Футболка базовая';
  const H = 'Худи оверсайз';
  c.rows = [
    row(A, T, 'S', 'Ширина груди', '46'),
    row(A, T, 'M', 'Ширина груди', '48'),
    row(A, T, 'L', 'Ширина груди', '51'),
    row(A, T, 'S', 'Длина по спинке', '68'),
    row(A, T, 'M', 'Длина по спинке', '69'),
    row(A, T, 'L', 'Длина по спинке', '70'),
    row(A, T, 'M', 'Длина рукава', '20'),
    row(B, T, 'S', 'Полуобхват груди', '50'),
    row(B, T, 'M', 'Полуобхват груди', '52'),
    row(B, T, 'L', 'Полуобхват груди', '54'),
    row(B, T, 'L', 'Полуобхват груди', '55'),
    row(B, T, 'S', 'Длина', '69'),
    row(B, T, 'M', 'Длина', '70,5'),
    row(B, T, 'L', 'Длина', '72'),
    row(B, T, 'M', 'Рукав', '21'),
    row(B, T, 'M', 'Обхват бёдер', '100'),
    row(C, T, 'S', 'Chest width', '18 1/2', 'in'),
    row(C, T, 'М', 'Chest width', '19 1/2', 'in'),
    row(C, T, 'L', 'Chest width', '20 1/2', 'in'),
    row(C, T, 'М', 'Body length', '27 1/4', 'in'),
    row(C, T, 'М', 'Sleeve', '', 'in'),
    row(A, H, 'M', 'Ширина груди', '62'),
    row(A, H, 'L', 'Ширина груди', '65'),
    row(B, H, 'M', 'Полуобхват груди', '61'),
    row(B, H, 'L', 'Полуобхват груди', '63,5'),
  ];
  const map = (s: string, label: string, typeId: string, method: Method) => (c.mappings[mapKey(s, label)] = { typeId, method });
  map(A, 'Ширина груди', 't-chest', 'flat');
  map(A, 'Длина по спинке', 't-length', 'length');
  map(A, 'Длина рукава', 't-sleeve', 'length');
  map(B, 'Полуобхват груди', 't-chest', 'flat');
  map(B, 'Длина', 't-length', 'length');
  map(B, 'Рукав', 't-sleeve', 'length');
  map(C, 'Chest width', 't-chest', 'flat');
  map(C, 'Body length', 't-length', 'length');
  map(C, 'Sleeve', 't-sleeve', 'length');
  return c;
}
