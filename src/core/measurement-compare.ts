/**
 * Сопоставление и сравнение. Строки группируются по (модель, размер, тип, способ измерения), значения
 * переводятся в целые мм, разброс — максимум минус минимум по поставщикам с данными. Пустые значения
 * не участвуют в расчёте. Неоднозначные строки (не сопоставлен тип, неверное значение, две строки на
 * одну и ту же ячейку у одного поставщика) в сравнение не попадают и выводятся отдельно.
 */
import { mapKey, normSize, normText, sizeCompare, METHOD_TEXT, type Chart, type Method, type Row } from './chart-editor';
import { overThreshold, thresholdMm, toMm, type Frac } from './unit-conversion';

export type IssueKind = 'unmapped' | 'invalid' | 'conflict';
export interface Issue {
  kind: IssueKind;
  rowIds: string[];
  supplierId: string;
  text: string;
  /** Для неверного значения — что не так, для подписи у поля. */
  message?: string;
}

export type Cell = { kind: 'value'; mm: number; rowId: string } | { kind: 'missing'; rowId?: string } | { kind: 'conflict' };

export interface Group {
  key: string;
  model: string;
  size: string;
  typeId: string;
  method: Method;
  /** По поставщикам модели, в порядке списка поставщиков. */
  cells: Record<string, Cell>;
  values: number;
  spread: number | null;
  over: boolean;
}

export interface Analysis {
  issues: Issue[];
  groups: Group[];
  /** Модели в порядке появления, без дублей по регистру и ё/е. */
  models: string[];
  /** Поставщики, у которых есть строки этой модели (по normText модели). */
  suppliersByModel: Record<string, string[]>;
  threshold: Frac | null;
  /** Настройки, с которыми посчитан анализ (на больших проектах он может отставать от полей на 250 мс). */
  settings: Chart['settings'];
  /** updatedAt проекта, по которому посчитан анализ. */
  updatedAt: number;
}

const groupKey = (model: string, size: string, typeId: string, method: Method) => `${normText(model)}|${normSize(size)}|${typeId}|${method}`;

export function analyze(c: Chart): Analysis {
  const issues: Issue[] = [];
  const names = Object.fromEntries(c.suppliers.map((s) => [s.id, s.name]));
  const typeName = Object.fromEntries(c.types.map((t) => [t.id, t.name]));
  const order = new Map(c.suppliers.map((s, i) => [s.id, i]));
  const modelName = new Map<string, string>();
  const suppliersByModel: Record<string, Set<string>> = {};
  const byCell = new Map<string, { gk: string; items: { row: Row; mm: number | null }[]; typeId: string; method: Method }>();

  for (const r of c.rows) {
    const mk = normText(r.model);
    if (!modelName.has(mk)) modelName.set(mk, r.model.trim());
    (suppliersByModel[mk] ??= new Set()).add(r.supplierId);
    const m = c.mappings[mapKey(r.supplierId, r.label)];
    const where = () => `${names[r.supplierId] ?? '?'}: ${r.model} · ${r.size} · «${r.label}»`;
    if (!m || !typeName[m.typeId]) {
      issues.push({ kind: 'unmapped', rowIds: [r.id], supplierId: r.supplierId, text: `${where()} — тип замера не сопоставлен` });
      continue;
    }
    const v = toMm(r.value, r.unit, c.settings.rounding);
    if (v.kind === 'error') {
      issues.push({ kind: 'invalid', rowIds: [r.id], supplierId: r.supplierId, text: `${where()} — «${r.value}»: ${v.message}`, message: v.message });
      continue;
    }
    const gk = groupKey(r.model, r.size, m.typeId, m.method);
    const k = `${r.supplierId}|${gk}`;
    const item = { row: r, mm: v.kind === 'ok' ? v.mm : null };
    const cell = byCell.get(k);
    if (cell) cell.items.push(item);
    else byCell.set(k, { gk, items: [item], typeId: m.typeId, method: m.method });
  }

  const groups = new Map<string, Group>();
  for (const { gk, items: list, typeId, method } of byCell.values()) {
    const { row } = list[0]!;
    let g = groups.get(gk);
    if (!g) {
      g = { key: gk, model: modelName.get(normText(row.model))!, size: normSize(row.size), typeId, method, cells: {}, values: 0, spread: null, over: false };
      groups.set(gk, g);
    }
    if (list.length > 1) {
      const vals = list.map((x) => x.row.value.trim() || 'пусто').join(' и ');
      issues.push({
        kind: 'conflict',
        rowIds: list.map((x) => x.row.id),
        supplierId: row.supplierId,
        text: `${names[row.supplierId]}: ${row.model} · ${normSize(row.size)} · ${typeName[typeId]} (${METHOD_TEXT[method]}) — ${list.length} строки на одну ячейку: ${vals}`,
      });
      g.cells[row.supplierId] = { kind: 'conflict' };
    } else {
      const x = list[0]!;
      g.cells[row.supplierId] = x.mm === null ? { kind: 'missing', rowId: x.row.id } : { kind: 'value', mm: x.mm, rowId: x.row.id };
    }
  }

  const thr = thresholdMm(c.settings.threshold, c.settings.thresholdUnit);
  const typeOrder = new Map(c.types.map((t, i) => [t.id, i]));
  const methodOrder: Record<Method, number> = { flat: 0, girth: 1, length: 2 };
  const out = [...groups.values()];
  for (const g of out) {
    const mm = Object.values(g.cells).flatMap((x) => (x.kind === 'value' ? [x.mm] : []));
    g.values = mm.length;
    g.spread = mm.length >= 2 ? Math.max(...mm) - Math.min(...mm) : null;
    g.over = g.spread !== null && thr !== null && overThreshold(g.spread, thr);
  }
  const models = [...modelName.values()];
  const modelIdx = new Map([...modelName.keys()].map((k, i) => [k, i]));
  out.sort(
    (a, b) =>
      modelIdx.get(normText(a.model))! - modelIdx.get(normText(b.model))! ||
      sizeCompare(a.size, b.size) ||
      typeOrder.get(a.typeId)! - typeOrder.get(b.typeId)! ||
      methodOrder[a.method] - methodOrder[b.method],
  );
  issues.sort((a, b) => (order.get(a.supplierId) ?? 0) - (order.get(b.supplierId) ?? 0));
  const sbm: Record<string, string[]> = {};
  for (const [k, set] of Object.entries(suppliersByModel)) sbm[k] = [...set].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return { issues, groups: out, models, suppliersByModel: sbm, threshold: thr, settings: c.settings, updatedAt: c.updatedAt };
}

export interface Summary {
  groups: number;
  over: number;
  incomplete: number;
}

export function summarize(groups: Group[], suppliers: string[]): Summary {
  return {
    groups: groups.length,
    over: groups.filter((g) => g.over).length,
    incomplete: groups.filter((g) => suppliers.some((s) => !g.cells[s] || g.cells[s]!.kind !== 'value')).length,
  };
}
