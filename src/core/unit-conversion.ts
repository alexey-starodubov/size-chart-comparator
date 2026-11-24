/**
 * Единицы и округление. Значения хранятся строкой, как их ввёл человек, и переводятся в целые
 * миллиметры точной дробной арифметикой: 19 1/2 дюйма = 495,3 мм → 495, без ошибок плавающей точки.
 */

export type Unit = 'cm' | 'in';
export type ShowUnit = Unit | 'mm';
export type Rounding = 'nearest' | 'down' | 'up';

export const UNIT_TEXT: Record<ShowUnit, string> = { cm: 'см', in: 'дюймы', mm: 'мм' };
export const UNIT_SHORT: Record<ShowUnit, string> = { cm: 'см', in: 'дюйм', mm: 'мм' };
export const ROUNDING_TEXT: Record<Rounding, string> = { nearest: 'до ближайшего мм', down: 'вниз до мм', up: 'вверх до мм' };

/** Точная положительная дробь n/d. */
export interface Frac {
  n: number;
  d: number;
}

export type Parsed = { kind: 'empty' } | { kind: 'ok'; value: Frac; unit?: Unit } | { kind: 'error'; message: string };

const FRACTIONS: Record<string, string> = { '½': ' 1/2', '¼': ' 1/4', '¾': ' 3/4', '⅛': ' 1/8', '⅜': ' 3/8', '⅝': ' 5/8', '⅞': ' 7/8', '⅓': ' 1/3', '⅔': ' 2/3' };
const MAX_MM = 10_000; // 10 м — заведомо не замер одежды

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function frac(n: number, d: number): Frac {
  const g = gcd(n, d) || 1;
  return { n: n / g, d: d / g };
}

/**
 * «48», «48,5», «48.5», «19 1/2», «19½», «7/8», с необязательной единицей: «48 см», «19"», «19 in».
 * Пустая строка — «нет данных». Ноль, минус, текст — ошибка с объяснением.
 */
export function parseValue(raw: string): Parsed {
  let s = raw.trim().toLowerCase();
  if (!s) return { kind: 'empty' };
  if (/[^\x20-\x7e]/.test(s)) for (const [k, v] of Object.entries(FRACTIONS)) s = s.replaceAll(k, v);
  let unit: Unit | undefined;
  const u = s.match(/\s*(см|cm|дюйм(?:а|ов)?|in|inch|inches|"|″|”)\.?$/);
  if (u) {
    unit = /см|cm/.test(u[1]!) ? 'cm' : 'in';
    s = s.slice(0, u.index).trim();
  }
  s = s.replace(',', '.').replace(/\s+/g, ' ');
  let m: RegExpMatchArray | null;
  let value: Frac;
  if ((m = s.match(/^(\d{1,6})(?:\.(\d{1,4}))?$/))) {
    const dec = m[2] ?? '';
    const d = 10 ** dec.length;
    value = frac(Number(m[1]) * d + Number(dec || 0), d);
  } else if ((m = s.match(/^(?:(\d{1,4}) )?(\d{1,3})\/(\d{1,3})$/))) {
    const whole = Number(m[1] ?? 0);
    const num = Number(m[2]);
    const den = Number(m[3]);
    if (den === 0) return { kind: 'error', message: 'Знаменатель дроби не может быть нулём' };
    value = frac(whole * den + num, den);
  } else if (/^-/.test(s)) {
    return { kind: 'error', message: 'Замер не может быть отрицательным' };
  } else {
    return { kind: 'error', message: 'Не число: используйте 48, 48,5 или 19 1/2' };
  }
  if (value.n === 0) return { kind: 'error', message: 'Замер должен быть больше нуля' };
  return { kind: 'ok', value, unit };
}

/** Точное значение в миллиметрах (дробь): 1 см = 10 мм, 1 дюйм = 25,4 мм ровно. */
export function exactMm(v: Frac, unit: Unit): Frac {
  return unit === 'cm' ? frac(v.n * 10, v.d) : frac(v.n * 254, v.d * 10);
}

/** Целые миллиметры с выбранным округлением. Половина при «до ближайшего» округляется вверх. */
export function roundMm(x: Frac, rounding: Rounding): number {
  if (rounding === 'down') return Math.floor(x.n / x.d);
  if (rounding === 'up') return Math.ceil(x.n / x.d);
  return Math.floor((2 * x.n + x.d) / (2 * x.d));
}

export type MmResult = { kind: 'empty' } | { kind: 'ok'; mm: number } | { kind: 'error'; message: string };

const mmCache = new Map<string, MmResult>();

/** Строка значения + единица строки → целые мм. Единица в самом значении («19"») важнее единицы строки. */
export function toMm(raw: string, unit: Unit, rounding: Rounding): MmResult {
  const k = `${unit}|${rounding}|${raw}`;
  let r = mmCache.get(k);
  if (r === undefined) {
    if (mmCache.size > 100_000) mmCache.clear();
    r = toMmUncached(raw, unit, rounding);
    mmCache.set(k, r);
  }
  return r;
}

function toMmUncached(raw: string, unit: Unit, rounding: Rounding): MmResult {
  const p = parseValue(raw);
  if (p.kind !== 'ok') return p;
  const mm = roundMm(exactMm(p.value, p.unit ?? unit), rounding);
  if (mm > MAX_MM) return { kind: 'error', message: 'Слишком большое значение для замера одежды' };
  if (mm === 0) return { kind: 'error', message: 'После округления получается 0 мм' };
  return { kind: 'ok', mm };
}

/** Порог как точная дробь в мм (без округления): сравнение «строго больше порога» идёт без потерь. */
export function thresholdMm(raw: string, unit: Unit): Frac | null {
  const p = parseValue(raw);
  if (p.kind === 'empty') return { n: 0, d: 1 };
  if (p.kind !== 'ok') return null;
  return exactMm(p.value, p.unit ?? unit);
}

/** spread строго больше порога. */
export const overThreshold = (spreadMm: number, thr: Frac) => spreadMm * thr.d > thr.n;

/** Миллиметры для показа: «48,5» (см, один знак), «19,09» (дюймы, два знака), «485» (мм). */
export function formatMm(mm: number, unit: ShowUnit): string {
  if (unit === 'mm') return String(mm);
  const v = unit === 'cm' ? mm / 10 : mm / 25.4;
  return v.toFixed(unit === 'cm' ? 1 : 2).replace('.', ',');
}

/** Порог для подписи: «2 см», «0,5 дюйма». */
export function formatThreshold(raw: string, unit: Unit): string {
  return `${raw.trim().replace('.', ',') || '0'} ${unit === 'cm' ? 'см' : 'дюйм.'}`;
}
