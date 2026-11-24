import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { cmp, loadDemo, tmp } from './helpers';

test('перезагрузка сразу после правки значения: правка не теряется', async ({ page }) => {
  await loadDemo(page);
  await expect(page.getByTestId('save')).toHaveText('Сохранено в этом браузере');
  await page.getByLabel('Футболка базовая, M, Ширина груди: значение').fill('47');
  await page.reload(); // раньше, чем сработает отложенное сохранение
  await expect(page.getByLabel('Футболка базовая, M, Ширина груди: значение')).toHaveValue('47');
  await expect(page.getByTestId('save')).toHaveText('Сохранено в этом браузере');
  await page.goto('./#compare');
  await expect(cmp(page, 'M Грудь').getByTestId('spread')).toHaveText('5,0 — больше порога');
});

test('файл проекта: сохранить, открыть в чистом профиле; чужой и битый файл — ошибка без потери данных', async ({ page, browser }) => {
  await loadDemo(page);
  const dir = tmp();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить проект в файл (.json)' }).click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe('razmernye-setki.json');
  await d.saveAs(`${dir}/p.json`);
  const ctx = await browser.newContext({ locale: 'ru-RU' });
  const p = await ctx.newPage();
  await p.goto('./#compare');
  await p.getByText('Открыть проект из файла…').locator('input').setInputFiles(`${dir}/p.json`);
  await expect(cmp(p, 'M Грудь').getByTestId('spread')).toHaveText('4,0 — больше порога');
  writeFileSync(`${dir}/bad.json`, '{"version":7}');
  writeFileSync(`${dir}/broken.json`, '{"version":');
  await p.getByText('Открыть проект из файла…').locator('input').setInputFiles(`${dir}/bad.json`);
  await expect(p.getByTestId('error')).toHaveText('Проект не открыт: Неизвестная версия файла проекта');
  await p.getByText('Открыть проект из файла…').locator('input').setInputFiles(`${dir}/broken.json`);
  await expect(p.getByTestId('error')).toHaveText('Проект не открыт: файл не JSON или повреждён');
  await expect(cmp(p, 'M Грудь')).toBeVisible();
  await ctx.close();
});

test('без IndexedDB: работа в памяти с предупреждением', async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { get: () => ({ open: () => { throw new Error('нет'); }, deleteDatabase: () => ({}) }) });
  });
  const p = await ctx.newPage();
  await p.goto('./#compare');
  await expect(p.getByTestId('save')).toHaveText('Хранилище браузера недоступно: данные живут до закрытия вкладки, сохраните файл проекта');
  await p.getByRole('button', { name: 'Загрузить демо' }).click();
  await expect(cmp(p, 'M Грудь').getByTestId('spread')).toHaveText('4,0 — больше порога');
  await ctx.close();
});

test('удаление поставщика — с подтверждением, сравнение пересчитывается', async ({ page }) => {
  await loadDemo(page);
  await page.getByLabel('Поставщик', { exact: true }).selectOption({ label: 'Хлопок-Юг' });
  await page.getByRole('button', { name: 'Удалить поставщика' }).click();
  await expect(page.getByText('Удалить «Хлопок-Юг» и его 11 строк?')).toBeVisible();
  await page.getByRole('button', { name: 'Отмена' }).click();
  await page.getByRole('button', { name: 'Удалить поставщика' }).click();
  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.getByTestId('notice')).toHaveText('Поставщик «Хлопок-Юг» удалён');
  await page.goto('./#compare');
  await expect(cmp(page, 'M Грудь').getByTestId('spread')).toHaveText('1,5'); // 48 и 49,5
  await expect(page.getByTestId('issues-banner')).toHaveCount(0);
});
