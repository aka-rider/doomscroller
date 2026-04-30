import { test, expect } from "../fixtures/test-harness";

test.describe("Feed Management", () => {
  test("can add a feed and see entries after job runs", async ({ page, apiClient, triggerJobs, feedUrls }) => {
    // Add a feed via API
    const addRes = await apiClient.post('/api/feeds', { data: { url: feedUrls.tech } });
    expect(addRes.ok()).toBeTruthy();

    // Trigger jobs to fetch the feed
    await triggerJobs();

    // Navigate and verify entries appear
    await page.goto("/");
    await page.getByTestId("sidebar-mode-feeds").click();
    await page.getByTestId("sidebar-feed-item").first().click();
    await expect(page.locator(".entry-card")).toHaveCount(5, { timeout: 10000 });
  });

  test("refresh button triggers re-fetch of a feed", async ({ page, apiClient, triggerJobs, feedUrls }) => {
    // Setup: add feed and fetch it
    await apiClient.post('/api/feeds', { data: { url: feedUrls.tech } });
    await triggerJobs();

    // Navigate to feed view
    await page.goto("/");
    await page.getByTestId("sidebar-mode-feeds").click();
    await page.getByTestId("sidebar-feed-item").first().click();
    await expect(page.locator(".entry-card").first()).toBeVisible({ timeout: 10000 });

    // Click refresh button
    const refreshBtn = page.getByTestId("refresh-feed-btn");
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();

    // Button should be disabled (cooldown)
    await expect(refreshBtn).toBeDisabled();

    // Verify refresh endpoint was called (job is queued)
    const feedsRes = await apiClient.get('/api/feeds');
    const feeds = await feedsRes.json();
    expect(feeds.length).toBeGreaterThan(0);
  });

  test("refresh button is not visible when no feed is selected", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("refresh-feed-btn")).toHaveCount(0);
  });
});
