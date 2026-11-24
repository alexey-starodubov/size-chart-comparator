import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { cmp, freshApp, loadDemo, row, tmp } from './helpers';

test('приёмка ТЗ с нуля: два поставщика, M 48 и 52 см, порог 2 см — расхождение 4 см подсвечено', async ({ page }) => {
  await freshApp(page);
  for (const [name, label, value] of [
    ['Поставщик А', 'Ширина груди', '48'],
    ['Поставщик Б', 'Полуобхват груди', '52'],
  ]) {
    await page.getByLabel('Новый поставщик').fill(name!);
    await page.getByRole('button', { name: 'Добавить поставщика' }).click();
    await expect(page.getByLabel('Поставщик', { exact: true })).toHaveValue(/.+/);
    await page.getByLabel('Модель', { exact: true }).last().fill('Футболка');
    await page.getByLabel('Размер', { exact: true }).fill('M');
    await page.getByLabel('Замер у поставщика', { exact: true }).fill(label!);
    await page.getByLabel('Значение', { exact: true }).fill(value!);
    await page.getByRole('button', { name: 'Добавить строку' }).click();
    await expect(page.getByTestId('notice')).toHaveText(`Строка добавлена: Футболка · M · ${label} · ${value}`);
  }
  await page.getByRole('link', { name: /Сопоставление/ }).click();
  await expect(page.getByTestId('issue')).toHaveCount(2);
  for (const sup of ['Поставщик А, «Ширина груди»', 'Поставщик Б, «Полуобхват груди»']) {
    await page.getByLabel(`${sup}: тип замера`).first().selectOption({ label: 'Грудь' });
  }
  await expect(page.getByText('Все строки однозначны и участвуют в сравнении.')).toBeVisible();
  await page.getByRole('link', { name: 'Сравнение' }).click();
  const r = cmp(page, 'M Грудь');
  await expect(r).toHaveClass(/row--over/);
  await expect(r.getByTestId('spread')).toHaveText('4,0 — больше порога');
  await expect(r).toContainText('48,0');
  await expect(r).toContainText('52,0');
  await expect(page.getByTestId('summary')).toHaveText('Строк сравнения: 1, больше порога 2 см: 1, с пропусками: 0. Значения в см, округление до ближайшего мм.');
});

test('порог: ровно на пороге не подсвечено, строго больше — подсвечено; порог в дюймах', async ({ page }) => {
  await loadDemo(page, '#compare');
  const l = cmp(page, 'L Длина изделия');
  await expect(l.getByTestId('spread')).toHaveText('2,0');
  await expect(l).not.toHaveClass(/row--over/);
  await page.getByLabel('Порог расхождения').fill('1,9');
  await expect(l.getByTestId('spread')).toHaveText('2,0 — больше порога');
  await page.getByLabel('Порог расхождения').fill('0,75');
  await page.getByLabel('Единица порога').selectOption('in'); // 19,05 мм < 20 мм
  await expect(l.getByTestId('spread')).toHaveText('2,0 — больше порога');
  await page.getByLabel('Порог расхождения').fill('0,8'); // 20,32 мм
  await expect(l.getByTestId('spread')).toHaveText('2,0');
  await page.getByLabel('Порог расхождения').fill('два');
  await expect(page.getByText('Порог — число, например 2 или 0,5')).toBeVisible();
  await expect(page.getByLabel('Порог расхождения')).toHaveAttribute('aria-invalid', 'true');
});

test('смешанные сантиметры и дюймы, показ в дюймах и мм, округление', async ({ page }) => {
  await loadDemo(page, '#compare');
  const m = cmp(page, 'M Грудь');
  await expect(m.locator('td')).toHaveText(['Грудь (по плоскости)', '48,0', '52,0', '49,5', '4,0 — больше порога']);
  await page.getByLabel('Показывать в').selectOption('mm');
  await expect(m.locator('td')).toHaveText(['Грудь (по плоскости)', '480', '520', '495', '40 — больше порога']);
  await page.getByLabel('Округление до целых мм').selectOption('up');
  await expect(m.locator('td').nth(3)).toHaveText('496'); // 19 1/2″ = 495,3 мм
  await page.getByLabel('Показывать в').selectOption('in');
  await expect(page.getByRole('columnheader', { name: 'Вязальщик, дюйм' })).toBeVisible();
  await expect(page.getByTestId('summary')).toContainText('Значения в дюймах, округление вверх до мм.');
});

test('нет данных: пропуск не участвует в расчёте, загрузка таблицы с пропусками сохраняет остальные строки', async ({ page }) => {
  await loadDemo(page);
  await page.getByText('Вставить таблицу поставщика').click();
  await page.getByLabel('Строки для «Ткани Севера»').fill('Модель;Размер;Замер;Значение;Единица\nПоло;S;Ширина груди;45;см\nПоло;M;Ширина груди;;см\nПоло;L;Ширина груди;50,5;см\n;XL;Ширина груди;53;см');
  await page.getByRole('button', { name: 'Загрузить строки' }).click();
  await expect(page.getByTestId('notice')).toHaveText('Загружено строк: 3, без значения (нет данных): 1, пропущено с ошибками: 1');
  await expect(page.getByTestId('import-errors')).toHaveText('строка 5: нужны модель, размер и замер');
  await expect(row(page, 'Поло M Ширина груди').getByLabel('Поло, M, Ширина груди: значение')).toHaveAttribute('placeholder', 'нет данных');
  await page.getByRole('link', { name: 'Сравнение' }).click();
  const sleeve = cmp(page, 'M Рукав');
  await expect(sleeve.locator('td').nth(3)).toHaveText('нет данных');
  await expect(sleeve.getByTestId('spread')).toHaveText('1,0');
  await page.getByLabel('Модель', { exact: true }).selectOption({ label: 'Поло' });
  await expect(cmp(page, 'M Грудь').locator('td').nth(1)).toHaveText('нет данных');
  await expect(cmp(page, 'M Грудь').getByTestId('spread')).toHaveText('мало данных');
  await expect(cmp(page, 'L Грудь').locator('td').nth(1)).toHaveText('50,5');
});

test('конфликт двух строк: в неоднозначных, не в сравнении; удаление одной строки возвращает расчёт', async ({ page }) => {
  await loadDemo(page, '#map');
  const issue = page.locator('[data-testid="issue"][data-kind="conflict"]');
  await expect(issue).toContainText('Хлопок-Юг: Футболка базовая · L · Грудь (по плоскости) — 2 строки на одну ячейку: 54 и 55');
  await page.getByRole('link', { name: 'Сравнение' }).click();
  await expect(cmp(page, 'L Грудь').locator('td').nth(2)).toHaveText('конфликт строк');
  await expect(cmp(page, 'L Грудь').getByTestId('spread')).toHaveText('1,1');
  await expect(page.getByTestId('issues-banner')).toContainText('Неоднозначных строк: 2');
  await page.getByRole('link', { name: 'Исправить' }).click();
  await issue.getByRole('button', { name: 'Удалить строку Футболка базовая L «Полуобхват груди» = 55' }).click();
  await expect(page.getByTestId('notice')).toHaveText('Строка «Полуобхват груди» = 55 удалена');
  await expect(page.getByRole('link', { name: /Сопоставление/ })).toContainText('1');
  await page.getByRole('link', { name: 'Сравнение' }).click();
  await expect(cmp(page, 'L Грудь').getByTestId('spread')).toHaveText('3,0 — больше порога'); // 51, 54, 52,1
});

test('несопоставленный замер: новый тип и способ «по обхвату» снимают неоднозначность', async ({ page }) => {
  await loadDemo(page, '#map');
  await page.getByLabel('Новый тип').fill('Бёдра');
  await page.getByRole('button', { name: 'Добавить тип' }).click();
  const issue = page.locator('[data-testid="issue"][data-kind="unmapped"]');
  await issue.getByLabel('Хлопок-Юг, «Обхват бёдер»: тип замера').selectOption({ label: 'Бёдра' });
  await expect(issue).toHaveCount(0);
  await page.getByLabel('Хлопок-Юг, «Обхват бёдер»: способ измерения').selectOption('girth');
  await page.getByRole('link', { name: 'Сравнение' }).click();
  await expect(cmp(page, 'M Бёдра')).toContainText('Бёдра (по обхвату)');
  await expect(cmp(page, 'M Бёдра').getByTestId('spread')).toHaveText('мало данных');
});

test('таблица для карточки товара: CSV с подписями единиц и способа, печатается только таблица', async ({ page }) => {
  await loadDemo(page, '#card');
  await page.getByLabel('Поставщик').selectOption({ label: 'Вязальщик' });
  const t = page.getByTestId('card-table');
  await expect(t.locator('thead th')).toHaveText(['Размер', 'Грудь, см (по плоскости)', 'Длина изделия, см (по длине)', 'Рукав, см (по длине)']);
  await expect(t.locator('tbody tr').nth(1)).toHaveText(/M\s*49,5\s*69,2\s*нет данных/);
  const dir = tmp();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать CSV' }).click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe('futbolka-bazovaya-vyazalschik.csv');
  await d.saveAs(`${dir}/card.csv`);
  expect(readFileSync(`${dir}/card.csv`, 'utf8').split('\r\n')).toEqual([
    '﻿Размер;Грудь, см (по плоскости);Длина изделия, см (по длине);Рукав, см (по длине)',
    'S;47,0;нет данных;нет данных',
    'M;49,5;69,2;нет данных',
    'L;52,1;нет данных;нет данных',
    '',
  ]);
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('heading', { name: 'Футболка базовая: замеры изделия, см' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Скачать CSV' })).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Разделы' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Проект целиком' })).toBeHidden();
});

test('CSV сравнения и правка значения: неверное значение — ошибка у поля и в неоднозначных', async ({ page }) => {
  await loadDemo(page, '#compare');
  const dir = tmp();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать CSV сравнения' }).click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe('sravnenie-futbolka-bazovaya.csv');
  await d.saveAs(`${dir}/cmp.csv`);
  const lines = readFileSync(`${dir}/cmp.csv`, 'utf8').split('\r\n');
  expect(lines[0]).toBe('﻿Модель;Размер;Замер;Способ;Ткани Севера, см;Хлопок-Юг, см;Вязальщик, см;Разброс, см;Больше порога 2 см');
  expect(lines).toContain('Футболка базовая;M;Грудь;по плоскости;48,0;52,0;49,5;4,0;да');
  expect(lines).toContain('Футболка базовая;L;Грудь;по плоскости;51,0;конфликт строк;52,1;1,1;нет');

  await page.getByRole('link', { name: 'Замеры поставщиков' }).click();
  const v = page.getByLabel('Футболка базовая, M, Ширина груди: значение');
  await v.fill('4 8');
  await expect(v).toHaveAttribute('aria-invalid', 'true');
  await expect(row(page, 'Футболка базовая M Ширина груди')).toContainText('Не число: используйте 48, 48,5 или 19 1/2');
  await expect(page.getByRole('link', { name: /Сопоставление/ })).toContainText('3');
  await v.fill('48,5');
  await page.getByRole('link', { name: 'Сравнение' }).click();
  await expect(cmp(page, 'M Грудь').getByTestId('spread')).toHaveText('3,5 — больше порога');
});
