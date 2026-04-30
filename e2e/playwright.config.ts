import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // serial execution since app has one DB
  reporter: [["html", { outputFolder: "./playwright-report" }]],
  use: {
    baseURL: "http://doomscroller:6767",
    trace: "on-first-retry",
  },
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  outputDir: "./results",
});
