import { expect, test } from '@playwright/test';
import { search, signUp } from './helpers';

test('a keyboard reorder of a playlist survives a reload @live', async ({ page }) => {
  await signUp(page);
  await page.getByRole('button', { name: 'New playlist' }).click();
  await page.getByLabel('Name').fill('Commute');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/playlist\//);
  const playlistUrl = page.url();

  const results = await search(page, 'ambient');
  const titles: string[] = [];
  for (const n of [0, 1]) {
    const row = results.getByRole('listitem').nth(n);
    titles.push((await row.getByRole('button', { name: /^Play / }).textContent()) ?? '');
    await row.getByRole('button', { name: /^More options/ }).click();
    // Keyboard into the submenu: pointer jumps can leave Radix's hover grace area.
    await page.getByRole('menuitem', { name: 'Add to playlist' }).focus();
    await page.keyboard.press('ArrowRight');
    const added = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/tracks'),
    );
    await page.getByRole('menuitem', { name: 'Commute' }).press('Enter');
    expect((await added).status()).toBe(201);
  }

  await page.goto(playlistUrl);
  const order = () =>
    page
      .getByRole('list', { name: 'Commute' })
      .getByRole('button', { name: /^(Play|Pause) / })
      .allTextContents();
  await expect.poll(order).toEqual(titles);

  // Each key waits for dnd-kit's spoken confirmation, so none arrives before the list is ready.
  const spoken = page.locator('[id^="DndLiveRegion"]');
  await page.getByRole('button', { name: `Reorder ${titles[1]}` }).focus();
  await page.keyboard.press('Space');
  // Picked up: dnd-kit then announces the starting position, over the item itself.
  await expect(spoken).toContainText(`${titles[1]} is at position 2 of 2`);
  await page.keyboard.press('ArrowUp');
  await expect(spoken).toContainText('is at position 1 of 2');
  await page.keyboard.press('Space');
  await expect(spoken).toContainText('dropped at position 1 of 2');
  await expect.poll(order).toEqual([titles[1], titles[0]]);

  await page.reload();
  await expect.poll(order).toEqual([titles[1], titles[0]]);
});
