/** Экспорт: CSV сравнения и таблица замеров для карточки товара (CSV и печать). */
import { METHOD_TEXT, normText, sizeCompare, type Chart, type Method } from './chart-editor';
import type { Analysis, Cell, Group } from './measurement-compare';
import { formatMm, formatThreshold, UNIT_SHORT, type ShowUnit } from './unit-conversion';

/** Ячейка CSV: «;» и кавычки экранируются, начало с = + - @ — апострофом (защита от формул в Excel). */
export function csvCell(v: string): string {
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
const csv = (rows: string[][]) => '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';

export const cellText = (cell: Cell | undefined, show: ShowUnit) =>
  !cell ? 'нет данных' : cell.kind === 'value' ? formatMm(cell.mm, show) : cell.kind === 'missing' ? 'нет данных' : 'конфликт строк';

export const typeTitle = (c: Chart, typeId: string, method: Method, show: ShowUnit) =>
  `${c.types.find((t) => t.id === typeId)?.name ?? '?'}, ${UNIT_SHORT[show]} (${METHOD_TEXT[method]})`;

/** CSV сравнения по модели (или всем моделям): значения в выбранной единице, разброс, превышение порога. */
export function comparisonCsv(c: Chart, a: Analysis, groups: Group[]): string {
  const show = c.settings.show;
  const sup = c.suppliers;
  const head = ['Модель', 'Размер', 'Замер', 'Способ', ...sup.map((s) => `${s.name}, ${UNIT_SHORT[show]}`), `Разброс, ${UNIT_SHORT[show]}`, `Больше порога ${formatThreshold(c.settings.threshold, c.settings.thresholdUnit)}`];
  const rows = groups.map((g) => {
    const has = new Set(a.suppliersByModel[normText(g.model)] ?? []);
    return [
      g.model,
      g.size,
      c.types.find((t) => t.id === g.typeId)?.name ?? '?',
      METHOD_TEXT[g.method],
      ...sup.map((s) => (has.has(s.id) ? cellText(g.cells[s.id], show) : '')),
      g.spread === null ? 'мало данных' : formatMm(g.spread, show),
      g.over ? 'да' : 'нет',
    ];
  });
  return csv([head, ...rows]);
}

export interface CardTable {
  columns: { typeId: string; method: Method; title: string }[];
  rows: { size: string; cells: string[] }[];
}

/** Таблица для карточки: размеры по строкам, типы замеров по столбцам, значения одного поставщика. */
export function cardTable(c: Chart, a: Analysis, model: string, supplierId: string, show: ShowUnit): CardTable {
  const gs = a.groups.filter((g) => normText(g.model) === normText(model) && g.cells[supplierId]);
  const cols = new Map<string, { typeId: string; method: Method }>();
  for (const g of gs) cols.set(`${g.typeId}|${g.method}`, { typeId: g.typeId, method: g.method });
  const typeOrder = new Map(c.types.map((t, i) => [t.id, i]));
  const columns = [...cols.values()]
    .sort((x, y) => typeOrder.get(x.typeId)! - typeOrder.get(y.typeId)! || x.method.localeCompare(y.method))
    .map((x) => ({ ...x, title: typeTitle(c, x.typeId, x.method, show) }));
  const sizes = [...new Set(gs.map((g) => g.size))].sort(sizeCompare);
  const rows = sizes.map((size) => ({
    size,
    cells: columns.map((col) => cellText(gs.find((g) => g.size === size && g.typeId === col.typeId && g.method === col.method)?.cells[supplierId], show)),
  }));
  return { columns, rows };
}

export const cardCsv = (t: CardTable) => csv([['Размер', ...t.columns.map((x) => x.title)], ...t.rows.map((r) => [r.size, ...r.cells])]);

/** Имя файла латиницей: кириллица в атрибуте download ломается в части браузеров. */
export function fileName(base: string, ext: string): string {
  const map: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  const s = [...base.toLowerCase()].map((ch) => map[ch] ?? ch).join('');
  return `${s.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'table'}.${ext}`;
}
