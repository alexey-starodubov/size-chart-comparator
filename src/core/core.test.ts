import { describe, expect, it } from 'vitest';
import { addRow, addSupplier, demoChart, emptyChart, importRows, mapKey, normSize, parseChart, removeType, setMapping, sizeCompare, type Chart } from './chart-editor';
import { cardCsv, cardTable, comparisonCsv, csvCell, fileName } from './chart-export';
import { analyze, summarize } from './measurement-compare';
import { formatMm, overThreshold, parseValue, thresholdMm, toMm } from './unit-conversion';

/** Два поставщика, одна модель: строки «размер, замер, значение, единица». */
function chart(a: [string, string, string, 'cm' | 'in'][], b: [string, string, string, 'cm' | 'in'][], threshold = '2'): Chart {
  let c = emptyChart();
  c.settings.threshold = threshold;
  for (const [name, rows] of [['А', a], ['Б', b]] as const) {
    const r = addSupplier(c, name);
    if ('error' in r) throw new Error(r.error);
    c = r.chart;
    for (const [size, label, value, unit] of rows) {
      const x = addRow(c, { supplierId: r.id, model: 'Футболка', size, label, value, unit });
      if ('error' in x) throw new Error(x.error);
      c = x.chart;
      c = setMapping(c, r.id, label, { typeId: 't-chest', method: 'flat' });
    }
  }
  return c;
}

describe('unit-conversion', () => {
  it('разбор значений', () => {
    expect(parseValue('48')).toEqual({ kind: 'ok', value: { n: 48, d: 1 }, unit: undefined });
    expect(parseValue(' 48,5 ')).toEqual({ kind: 'ok', value: { n: 97, d: 2 }, unit: undefined });
    expect(parseValue('19 1/2')).toMatchObject({ kind: 'ok', value: { n: 39, d: 2 } });
    expect(parseValue('19½"')).toMatchObject({ kind: 'ok', value: { n: 39, d: 2 }, unit: 'in' });
    expect(parseValue('48 см')).toMatchObject({ kind: 'ok', unit: 'cm' });
    expect(parseValue('')).toEqual({ kind: 'empty' });
    expect(parseValue('0').kind).toBe('error');
    expect(parseValue('-3')).toEqual({ kind: 'error', message: 'Замер не может быть отрицательным' });
    expect(parseValue('сорок').kind).toBe('error');
    expect(parseValue('5/0')).toEqual({ kind: 'error', message: 'Знаменатель дроби не может быть нулём' });
  });
  it('целые мм: точная арифметика и выбранное округление', () => {
    expect(toMm('48', 'cm', 'nearest')).toEqual({ kind: 'ok', mm: 480 });
    expect(toMm('10,3', 'cm', 'nearest')).toEqual({ kind: 'ok', mm: 103 });
    expect(toMm('19 1/2', 'in', 'nearest')).toEqual({ kind: 'ok', mm: 495 }); // 495,3
    expect(toMm('19 1/2', 'in', 'up')).toEqual({ kind: 'ok', mm: 496 });
    expect(toMm('1/4', 'in', 'nearest')).toEqual({ kind: 'ok', mm: 6 }); // 6,35
    expect(toMm('0,05', 'cm', 'nearest')).toEqual({ kind: 'ok', mm: 1 }); // ровно 0,5 мм — половина вверх
    expect(toMm('0,05', 'cm', 'down')).toEqual({ kind: 'error', message: 'После округления получается 0 мм' });
    expect(toMm('19"', 'cm', 'nearest')).toEqual({ kind: 'ok', mm: 483 }); // единица в значении важнее
    expect(toMm('', 'cm', 'nearest')).toEqual({ kind: 'empty' });
    expect(toMm('2000', 'cm', 'nearest').kind).toBe('error');
  });
  it('порог: строго больше, без округления порога', () => {
    const t = thresholdMm('2', 'cm')!;
    expect(overThreshold(20, t)).toBe(false);
    expect(overThreshold(21, t)).toBe(true);
    const half = thresholdMm('0,5', 'in')!; // 12,7 мм
    expect(overThreshold(12, half)).toBe(false);
    expect(overThreshold(13, half)).toBe(true);
    expect(thresholdMm('abc', 'cm')).toBeNull();
    expect(formatMm(485, 'cm')).toBe('48,5');
    expect(formatMm(495, 'in')).toBe('19,49');
    expect(formatMm(40, 'mm')).toBe('40');
  });
});

describe('measurement-compare', () => {
  it('приёмка ТЗ: M 48 и 52 см при пороге 2 см — расхождение 4 см подсвечено', () => {
    const a = analyze(chart([['M', 'Ширина груди', '48', 'cm']], [['M', 'Полуобхват', '52', 'cm']]));
    expect(a.issues).toEqual([]);
    expect(a.groups).toHaveLength(1);
    expect(a.groups[0]).toMatchObject({ size: 'M', spread: 40, over: true, values: 2 });
    expect(formatMm(a.groups[0]!.spread!, 'cm')).toBe('4,0');
  });
  it('ровно на пороге — не подсвечено, на 1 мм больше — подсвечено', () => {
    expect(analyze(chart([['L', 'x', '70', 'cm']], [['L', 'y', '72', 'cm']])).groups[0]).toMatchObject({ spread: 20, over: false });
    expect(analyze(chart([['L', 'x', '70', 'cm']], [['L', 'y', '72,1', 'cm']])).groups[0]).toMatchObject({ spread: 21, over: true });
  });
  it('смешанные сантиметры и дюймы', () => {
    const g = analyze(chart([['M', 'x', '48', 'cm']], [['M', 'y', '19 1/2', 'in']])).groups[0]!;
    expect(g.spread).toBe(15); // 495 − 480
    expect(g.over).toBe(false);
  });
  it('нет данных: пустое значение не участвует в расчёте, остальные строки сохраняются', () => {
    const a = analyze(chart([['M', 'x', '48', 'cm'], ['L', 'x', '51', 'cm']], [['M', 'y', '', 'cm'], ['L', 'y', '54', 'cm']]));
    const [m, l] = a.groups;
    expect(m).toMatchObject({ size: 'M', values: 1, spread: null, over: false });
    expect(Object.values(m!.cells).map((x) => x.kind).sort()).toEqual(['missing', 'value']);
    expect(l).toMatchObject({ size: 'L', spread: 30, over: true });
    expect(summarize(a.groups, Object.keys(m!.cells))).toEqual({ groups: 2, over: 1, incomplete: 1 });
  });
  it('конфликт двух строк с одинаковой моделью, размером и типом', () => {
    const a = analyze(chart([['M', 'x', '48', 'cm']], [['M', 'y', '52', 'cm'], ['m', 'y', '53', 'cm']]));
    expect(a.issues).toHaveLength(1);
    expect(a.issues[0]).toMatchObject({ kind: 'conflict' });
    expect(a.issues[0]!.text).toContain('2 строки на одну ячейку: 52 и 53');
    expect(a.groups[0]).toMatchObject({ values: 1, spread: null, over: false });
    expect(Object.values(a.groups[0]!.cells).map((x) => x.kind).sort()).toEqual(['conflict', 'value']);
  });
  it('разные названия, сопоставленные с одним типом, у одного поставщика — тоже конфликт', () => {
    let c = chart([['M', 'Ширина груди', '48', 'cm'], ['M', 'Грудь ПО', '49', 'cm']], []);
    c = setMapping(c, c.suppliers[0]!.id, 'Грудь ПО', { typeId: 't-chest', method: 'flat' });
    expect(analyze(c).issues.map((i) => i.kind)).toEqual(['conflict']);
  });
  it('разный способ измерения не сравнивается', () => {
    let c = chart([['M', 'x', '48', 'cm']], [['M', 'y', '96', 'cm']]);
    c = setMapping(c, c.suppliers[1]!.id, 'y', { method: 'girth' });
    const a = analyze(c);
    expect(a.groups.map((g) => [g.method, g.values, g.spread])).toEqual([
      ['flat', 1, null],
      ['girth', 1, null],
    ]);
  });
  it('несопоставленный тип и неверное значение — в неоднозначных, не в сравнении', () => {
    let c = chart([['M', 'x', '48', 'cm'], ['M', 'z', '50', 'cm']], [['M', 'y', 'сорок', 'cm']]);
    c = setMapping(c, c.suppliers[0]!.id, 'z', null);
    const a = analyze(c);
    expect(a.issues.map((i) => i.kind).sort()).toEqual(['invalid', 'unmapped']);
    expect(a.groups[0]!.values).toBe(1);
    expect(analyze(removeType(c, 't-chest')).issues.filter((i) => i.kind === 'unmapped')).toHaveLength(3);
  });
  it('кириллическая «М» и латинская M — один размер, регистр и ё в модели не важны', () => {
    let c = chart([['M', 'x', '48', 'cm']], [['М', 'y', '50', 'cm']]);
    c = { ...c, rows: c.rows.map((r, i) => (i === 1 ? { ...r, model: '  футболка ' } : r)) };
    const a = analyze(c);
    expect(a.groups).toHaveLength(1);
    expect(a.groups[0]).toMatchObject({ model: 'Футболка', size: 'M', spread: 20 });
    expect(normSize('2xl')).toBe('XXL');
    expect(normSize('ХL')).toBe('XL');
  });
  it('порядок размеров', () => {
    expect(['XL', 'S', '3XL', 'M', '48', '46', 'XS', 'one size'].sort(sizeCompare)).toEqual(['XS', 'S', 'M', 'XL', '3XL', '46', '48', 'one size']);
  });
  it('демо: пересечения и неоднозначности на месте', () => {
    const c = demoChart();
    const a = analyze(c);
    expect(a.issues.map((i) => i.kind).sort()).toEqual(['conflict', 'unmapped']);
    const m = a.groups.find((g) => g.model === 'Футболка базовая' && g.size === 'M' && g.typeId === 't-chest')!;
    expect(m).toMatchObject({ values: 3, spread: 40, over: true });
    const l = a.groups.find((g) => g.model === 'Футболка базовая' && g.size === 'L' && g.typeId === 't-length')!;
    expect(l).toMatchObject({ spread: 20, over: false });
    const sleeve = a.groups.find((g) => g.size === 'M' && g.typeId === 't-sleeve')!;
    expect(sleeve.cells['s-knit']).toMatchObject({ kind: 'missing' });
    expect(sleeve.spread).toBe(10);
  });
});

describe('chart-editor', () => {
  it('загрузка таблицы: заголовок, табуляция, пропуски и ошибки с номерами строк', () => {
    const r = importRows('﻿Модель;Размер;Замер;Значение;Единица\nФутболка;M;Грудь;48;см\nФутболка;L;Грудь;;см\n;S;Грудь;46;см\nФутболка\tXL\tChest\t21\tin\nФутболка;XS;Грудь;44;мм\n', 's1', 'cm');
    expect(r.rows.map((x) => [x.size, x.value, x.unit])).toEqual([
      ['M', '48', 'cm'],
      ['L', '', 'cm'],
      ['XL', '21', 'in'],
    ]);
    expect(r.missing).toBe(1);
    expect(r.errors).toEqual(['строка 4: нужны модель, размер и замер', 'строка 6: неизвестная единица «мм» (см или дюймы)']);
    expect(importRows('Худи;M;Грудь;62', 's1', 'in').rows[0]!.unit).toBe('in');
  });
  it('поставщики и сопоставления', () => {
    let c = emptyChart();
    const r = addSupplier(c, '  Ткани  Севера ');
    expect('id' in r && r.chart.suppliers[0]!.name).toBe('Ткани Севера');
    c = (r as { chart: Chart }).chart;
    expect(addSupplier(c, 'ткани севера')).toEqual({ error: 'Поставщик «ткани севера» уже есть' });
    expect(addRow(c, { supplierId: 'x', model: 'A', size: ' ', label: 'B', value: '1', unit: 'cm' })).toEqual({ error: 'Укажите размер', field: 'size' });
    c = setMapping(c, 'x', 'Грудь ПО', { typeId: 't-chest' });
    expect(c.mappings[mapKey('x', ' грудь  по ')]).toEqual({ typeId: 't-chest', method: 'flat' });
  });
  it('файл проекта: проверка структуры', () => {
    const c = demoChart();
    expect(parseChart(JSON.parse(JSON.stringify(c)))).toMatchObject({ ok: true });
    expect(parseChart({ version: 2 })).toEqual({ ok: false, error: 'Неизвестная версия файла проекта' });
    expect(parseChart({ ...c, rows: [{ ...c.rows[0], supplierId: 'nobody' }] })).toMatchObject({ ok: false });
    expect(parseChart({ ...c, rows: [{ ...c.rows[0], unit: 'mm' }] })).toEqual({ ok: false, error: 'Повреждена строка замеров' });
    const p = parseChart({ ...c, settings: { threshold: 5, rounding: 'weird' } });
    expect(p.ok && p.chart.settings).toEqual({ threshold: '2', thresholdUnit: 'cm', rounding: 'nearest', show: 'cm' });
  });
});

describe('chart-export', () => {
  it('CSV: защита от формул, «;», кавычки и BOM', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('48;5')).toBe('"48;5"');
    expect(csvCell('Худи "Север"')).toBe('"Худи ""Север"""');
    const c = demoChart();
    const a = analyze(c);
    const text = comparisonCsv(c, a, a.groups.filter((g) => g.model === 'Футболка базовая' && g.size === 'M'));
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('﻿Модель;Размер;Замер;Способ;Ткани Севера, см;Хлопок-Юг, см;Вязальщик, см;Разброс, см;Больше порога 2 см');
    expect(lines[1]).toBe('Футболка базовая;M;Грудь;по плоскости;48,0;52,0;49,5;4,0;да');
    expect(lines).toContain('Футболка базовая;M;Рукав;по длине;20,0;21,0;нет данных;1,0;нет');
  });
  it('таблица для карточки: размеры × замеры с единицей и способом в заголовке', () => {
    const c = demoChart();
    const t = cardTable(c, analyze(c), 'Футболка базовая', 's-knit', 'cm');
    expect(t.columns.map((x) => x.title)).toEqual(['Грудь, см (по плоскости)', 'Длина изделия, см (по длине)', 'Рукав, см (по длине)']);
    expect(t.rows).toEqual([
      { size: 'S', cells: ['47,0', 'нет данных', 'нет данных'] },
      { size: 'M', cells: ['49,5', '69,2', 'нет данных'] },
      { size: 'L', cells: ['52,1', 'нет данных', 'нет данных'] },
    ]);
    expect(cardCsv(t).split('\r\n')[2]).toBe('M;49,5;69,2;нет данных');
    expect(fileName('Футболка базовая — Вязальщик', 'csv')).toBe('futbolka-bazovaya-vyazalschik.csv');
  });
});
