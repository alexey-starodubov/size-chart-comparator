import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshApp, tmp } from './helpers';

// Замер раунда 4: 8 поставщиков × 150 моделей × 6 размеров × 5 замеров = 36 000 строк,
// у двух поставщиков дюймы, каждая 50-я строка без значения, каждая 400-я с неверным значением.
test('36 000 строк: открытие, сравнение, переключение модели, ввод значения, сопоставление', async ({ page }) => {
  test.setTimeout(180_000);
  await freshApp(page);
  const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  const labels = ['Ширина груди', 'Талия', 'Длина', 'Рукав', 'Плечи'];
  const types = [
    { id: 't-chest', name: 'Грудь' },
    { id: 't-waist', name: 'Талия' },
    { id: 't-length', name: 'Длина изделия' },
    { id: 't-sleeve', name: 'Рукав' },
    { id: 't-shoulder', name: 'Плечи' },
  ];
  const suppliers = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, name: `Поставщик ${i + 1}` }));
  const mappings: Record<string, { typeId: string; method: string }> = {};
  for (const s of suppliers) labels.forEach((l, k) => (mappings[`${s.id}\u0000${l.toLowerCase()}`] = { typeId: types[k]!.id, method: k === 0 || k === 1 ? 'flat' : 'length' }));
  const rows = [];
  let n = 0;
  for (const s of suppliers)
    for (let m = 0; m < 150; m++)
      for (let z = 0; z < 6; z++)
        for (let k = 0; k < 5; k++) {
          n++;
          const inch = s.id === 's6' || s.id === 's7';
          const base = [46, 40, 68, 20, 42][k]! + z * 2 + ((m * 3 + Number(s.id.slice(1)) * 7) % 9) * 0.3;
          const value = n % 400 === 0 ? 'н/д' : n % 50 === 0 ? '' : inch ? (base / 2.54).toFixed(2) : String(base).replace('.', ',');
          rows.push({ id: `r${n}`, supplierId: s.id, model: `Модель ${String(m + 1).padStart(3, '0')}`, size: sizes[z], label: labels[k], value, unit: inch ? 'in' : 'cm' });
        }
  const chart = { version: 1, updatedAt: Date.now(), suppliers, types, mappings, rows, settings: { threshold: '2', thresholdUnit: 'cm', rounding: 'nearest', show: 'cm' } };
  const dir = tmp();
  writeFileSync(`${dir}/big.json`, JSON.stringify(chart));

  await page.goto('./#compare');
  let t0 = Date.now();
  await page.getByText('Открыть проект из файла…').locator('input').setInputFiles(`${dir}/big.json`);
  await expect(page.getByTestId('cmp')).toHaveCount(30);
  const openMs = Date.now() - t0;
  const issues = Number((await page.getByTestId('issues-banner').textContent())!.match(/\d+/)![0]);
  const over = (await page.getByTestId('summary').textContent())!;

  t0 = Date.now();
  await page.getByLabel('Модель', { exact: true }).selectOption({ label: 'Модель 150' });
  await expect(page.getByTestId('cmp').first()).toContainText('XS');
  const modelMs = Date.now() - t0;

  t0 = Date.now();
  await page.getByLabel('Порог расхождения').fill('1');
  await expect(page.getByTestId('summary')).toContainText('больше порога 1 см');
  const thresholdMs = Date.now() - t0;

  t0 = Date.now();
  await page.goto('./#data');
  await expect(page.getByTestId('row')).toHaveCount(100);
  const dataMs = Date.now() - t0;
  // Ввод в поле значения: пересчёт анализа всех 36 000 строк и перерисовка, замер внутри страницы.
  const typing = await page.evaluate(async () => {
    const el = document.querySelector<HTMLInputElement>('input[data-col="value"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t = performance.now();
      setter.call(el, String(40 + i));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    return { median: Math.round(times[5]!), max: Math.round(times[9]!) };
  });

  // Отложенный анализ всё равно доходит до сравнения: последнее введённое значение 49 см.
  await page.goto('./#compare');
  await page.getByLabel('Модель', { exact: true }).selectOption({ label: 'Модель 001' });
  await expect(page.locator('[data-testid="cmp"][data-cmp="XS Грудь"] td').nth(1)).toHaveText('49,0');

  t0 = Date.now();
  await page.goto('./#map');
  await expect(page.getByTestId('issue').first()).toBeVisible();
  const mapMs = Date.now() - t0;
  const issueItems = await page.getByTestId('issue').count();
  console.log('PERF220', JSON.stringify({ rows: rows.length, issues, over, openMs, modelMs, thresholdMs, dataMs, typing, mapMs, issueItems }));
});
