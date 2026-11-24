import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';

export const tmp = () => mkdtempSync(join(tmpdir(), 'scc-'));

export async function freshApp(page: Page, hash = '#data'): Promise<void> {
  await page.goto(`./${hash}`);
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise<void>((resolve) => {
      const r = indexedDB.deleteDatabase('size-chart-comparator');
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    });
  });
  await page.reload();
  await expect(page.getByTestId('save')).not.toHaveText('Открываю проект…');
}

export async function loadDemo(page: Page, hash = '#data'): Promise<void> {
  await freshApp(page, hash);
  await page.getByRole('button', { name: 'Загрузить демо' }).click();
  await expect(page.getByTestId('notice')).toHaveText('Загружено демо: три поставщика, футболка и худи');
}

/** Строка сравнения по размеру и типу: «M Грудь». */
export const cmp = (page: Page, key: string) => page.locator(`[data-testid="cmp"][data-cmp="${key}"]`);
/** Строка редактора: «Футболка базовая M Ширина груди». */
export const row = (page: Page, key: string) => page.locator(`[data-testid="row"][data-row="${key}"]`);
