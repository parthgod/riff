import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/**
 * Offline stand-ins for upstream data that each carry one long unbroken line (a URL in a bio,
 * say). Returns the pages that show them and the line itself.
 */
async function stubLongUpstreamText(page: Page) {
  const long = `https://example.com/${'x'.repeat(300)}`;
  const playlist = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  const stubs: Record<string, unknown> = {
    '/api/artists/audius:wide': {
      id: 'audius:wide',
      source: 'audius',
      name: 'Wide Bio',
      avatar: {},
      verified: false,
      bio: `Find me at ${long}`,
    },
    '/api/artists/audius:wide/tracks': [],
    '/api/artists/audius:wide/related': [],
    '/api/collections/audius:album:wide': {
      id: 'audius:album:wide',
      source: 'audius',
      kind: 'album',
      title: 'Wide Notes',
      artwork: {},
      owner: { id: 'audius:wide', name: 'Wide Bio' },
      description: `Liner notes: ${long}`,
      tracks: [],
    },
    [`/api/playlists/${playlist}`]: {
      id: playlist,
      name: 'Wide playlist',
      description: `Notes: ${long}`,
      coverUrl: null,
      isPublic: true,
      trackCount: 0,
      covers: [],
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
      ownerId: 'someone-else',
      isOwner: false,
      entries: [],
    },
  };
  await page.route(/\/api\/(artists|collections|playlists)\//, (route) => {
    const body = stubs[new URL(route.request().url()).pathname];
    return body === undefined ? route.continue() : route.fulfill({ json: body });
  });
  return {
    long,
    paths: ['/artist/audius:wide', '/collection/audius:album:wide', `/playlist/${playlist}`],
  };
}

test('signed-out visitors are sent to sign-in and brought back after', async ({ page }) => {
  await page.goto('/library');
  await expect(page).toHaveURL('/sign-in?next=%2Flibrary');
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page).toHaveURL('/sign-up?next=%2Flibrary');
});

test('pages fit a 360 px phone without sideways scrolling, and hydrate cleanly', async ({
  page,
}) => {
  const hydrationErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /hydrat/i.test(message.text())) {
      hydrationErrors.push(message.text());
    }
  });
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/sign-in');
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  expect(await overflow()).toBe(0);

  await signUp(page);
  for (const path of ['/library', '/liked', '/search']) {
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Main' }).last()).toBeVisible();
    expect(await overflow(), path).toBe(0);
  }
  // Long upstream text wraps instead of widening the page.
  const { long, paths } = await stubLongUpstreamText(page);
  for (const path of paths) {
    await page.goto(path);
    await expect(page.getByText(long)).toBeVisible();
    expect(await overflow(), path).toBe(0);
  }
  expect(hydrationErrors).toEqual([]);
});
