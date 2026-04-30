import { test as base } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

export const test = base.extend<{
  resetApp: void;
  triggerJobs: () => Promise<void>;
  apiClient: APIRequestContext;
  feverClient: APIRequestContext;
  feedUrls: { tech: string; news: string; large: string };
  faultFeedUrls: { error500: string; timeout: string };
}>({
  feedUrls: async ({ }, use) => {
    await use({
      tech: 'http://mock-feeds:3333/tech-blog.xml',
      news: 'http://mock-feeds:3333/world-news.xml',
      large: 'http://mock-feeds:3333/large-feed.xml',
    });
  },
  faultFeedUrls: async ({ }, use) => {
    await use({
      error500: 'http://mock-feeds:3333/500-feed.xml',
      timeout: 'http://mock-feeds:3333/timeout-feed.xml',
    });
  },
  resetApp: [async ({ request }, use) => {
    const res = await request.post('/api/test/reset');
    if (!res.ok()) {
      throw new Error(`Failed to reset app: ${res.status()} ${await res.text()}`);
    }
    await use();
  }, { auto: true }],
  triggerJobs: async ({ request }, use) => {
    const trigger = async () => {
      const res = await request.post('/api/test/trigger-jobs');
      if (!res.ok()) {
        throw new Error(`Failed to trigger jobs: ${res.status()} ${await res.text()}`);
      }
    };
    await use(trigger);
  },
  apiClient: async ({ request }, use) => {
    await use(request);
  },
  feverClient: async ({ request }, use) => {
    await use(request);
  },
});

export { expect } from '@playwright/test';
