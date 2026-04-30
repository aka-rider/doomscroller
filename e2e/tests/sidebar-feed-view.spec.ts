import { test, expect } from "../fixtures/test-harness";

test.describe("Sidebar Feed View", () => {
  test("toggle is visible after app loads", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByTestId("sidebar-mode-toggle");
    await expect(toggle).toBeVisible();
    await expect(page.getByTestId("sidebar-mode-topics")).toBeVisible();
    await expect(page.getByTestId("sidebar-mode-feeds")).toBeVisible();
  });

  test("switch to feeds mode shows feed list", async ({ page, apiClient, triggerJobs, feedUrls }) => {
    // Add a feed and populate entries
    await apiClient.post("/api/feeds", { data: { url: feedUrls.tech } });
    await triggerJobs();

    await page.goto("/");
    await page.getByTestId("sidebar-mode-feeds").click();

    // At least one feed item should appear
    await expect(page.getByTestId("sidebar-feed-item").first()).toBeVisible();
  });

  test("clicking a feed filters entries to that feed only", async ({ page, apiClient, triggerJobs, feedUrls }) => {
    // Add two feeds
    const techRes = await apiClient.post("/api/feeds", { data: { url: feedUrls.tech } });
    const techBody = await techRes.json() as { id: number };
    await apiClient.post("/api/feeds", { data: { url: feedUrls.news } });
    await triggerJobs();

    await page.goto("/");
    await page.getByTestId("sidebar-mode-feeds").click();

    // Get feed titles from the API
    const feedsRes = await apiClient.get("/api/feeds");
    const feeds = await feedsRes.json() as Array<{ id: number; title: string }>;
    const techFeed = feeds.find(f => f.id === techBody.id);
    expect(techFeed).toBeDefined();

    // Click the tech feed item
    await page.getByTestId("sidebar-feed-item").filter({ hasText: techFeed!.title }).click();

    // All visible entry cards should belong to the tech feed
    const entryFeedLabels = page.locator(".entry-feed-label");
    const count = await entryFeedLabels.count();
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        await expect(entryFeedLabels.nth(i)).toHaveText(techFeed!.title);
      }
    }
  });

  test("switching back to topics shows category list", async ({ page, apiClient, triggerJobs, feedUrls }) => {
    await apiClient.post("/api/feeds", { data: { url: feedUrls.tech } });
    await triggerJobs();

    await page.goto("/");
    await page.getByTestId("sidebar-mode-feeds").click();
    await page.getByTestId("sidebar-mode-topics").click();

    // Topics mode — the feeds toggle button is not active
    await expect(page.getByTestId("sidebar-mode-topics")).toHaveClass(/is-active/);
    await expect(page.getByTestId("sidebar-mode-feeds")).not.toHaveClass(/is-active/);

    // Feed items should not be visible
    await expect(page.getByTestId("sidebar-feed-item")).toHaveCount(0);
  });

  test("fixed views remain accessible from feeds mode", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("sidebar-mode-feeds").click();

    const sidebar = page.locator(".tag-sidebar");
    await expect(sidebar.getByText("Your Feed")).toBeVisible();
    await expect(sidebar.getByText("Favorites")).toBeVisible();
    await expect(sidebar.getByText("Everything")).toBeVisible();
    await expect(sidebar.getByText("Trash")).toBeVisible();
    await expect(sidebar.getByText("Noise")).toBeVisible();
  });

  test("selecting a fixed view clears active feed", async ({ page, apiClient, triggerJobs, feedUrls }) => {
    await apiClient.post("/api/feeds", { data: { url: feedUrls.tech } });
    await triggerJobs();

    await page.goto("/");
    await page.getByTestId("sidebar-mode-feeds").click();
    await page.getByTestId("sidebar-feed-item").first().click();

    // Now click "Everything" — active feed should clear
    await page.locator(".tag-sidebar").getByText("Everything").click();

    // No feed item should be active
    const activeItems = page.getByTestId("sidebar-feed-item").locator(".is-active");
    await expect(activeItems).toHaveCount(0);
  });

  test("unread only filter respects active feed selection", async ({ page, apiClient, triggerJobs, feedUrls }) => {
    await apiClient.post("/api/feeds", { data: { url: feedUrls.tech } });
    await triggerJobs();

    await page.goto("/");
    await page.getByTestId("sidebar-mode-feeds").click();
    await page.getByTestId("sidebar-feed-item").first().click();

    // Toggle unread only — the request should include both feed and unread params
    const [request] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/entries") && req.url().includes("feed=") && req.url().includes("unread=true")),
      page.getByRole("button", { name: /unread/i }).click(),
    ]);
    expect(request.url()).toContain("feed=");
    expect(request.url()).toContain("unread=true");
  });
});
