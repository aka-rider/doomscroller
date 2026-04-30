import { test, expect } from "../fixtures/test-harness";

test.describe("Entry List & Infinite Scroll", () => {
  test("loads initial batch of entries", async ({ page, apiClient, triggerJobs, feedUrls }) => {
    // Add a feed with enough entries
    await apiClient.post('/api/feeds', { data: { url: feedUrls.large } });
    await triggerJobs();

    await page.goto("/");

    // Switch to feed view
    await page.getByTestId("sidebar-mode-feeds").click();
    await page.getByTestId("sidebar-feed-item").first().click();

    // Should show first batch (50 entries)
    await expect(page.locator(".entry-card")).toHaveCount(50, { timeout: 15000 });

    // Sentinel should be visible
    await expect(page.getByTestId("infinite-scroll-sentinel")).toBeVisible();
  });

  test("infinite scroll loads more entries when scrolling to bottom", async ({ page, apiClient, triggerJobs, feedUrls }) => {
    await apiClient.post('/api/feeds', { data: { url: feedUrls.large } });
    await triggerJobs();

    await page.goto("/");
    await page.getByTestId("sidebar-mode-feeds").click();
    await page.getByTestId("sidebar-feed-item").first().click();
    await expect(page.locator(".entry-card").first()).toBeVisible({ timeout: 15000 });

    // Scroll the sentinel into view to trigger load more
    await page.getByTestId("infinite-scroll-sentinel").scrollIntoViewIfNeeded();

    // Wait for more entries to load (should now have > 50, up to 60)
    await expect(page.locator(".entry-card")).toHaveCount(60, { timeout: 15000 });
  });

  test("shows end-of-list when all entries are loaded", async ({ page, apiClient, triggerJobs, feedUrls }) => {
    // Use the tech feed which has only 5 entries (< PAGE_SIZE)
    await apiClient.post('/api/feeds', { data: { url: feedUrls.tech } });
    await triggerJobs();

    await page.goto("/");
    await page.getByTestId("sidebar-mode-feeds").click();
    await page.getByTestId("sidebar-feed-item").first().click();

    await expect(page.locator(".entry-card")).toHaveCount(5, { timeout: 15000 });
    // "End of list" should appear
    await expect(page.getByText("End of list")).toBeVisible();
  });
});
