import { Hono } from "hono";
import { readFileSync } from "fs";
import { join } from "path";

const app = new Hono();

function serveFeed(c: any, filename: string) {
  try {
    const xml = readFileSync(join(__dirname, "feeds", filename), "utf-8");
    const etag = `W/"${Buffer.from(xml).byteLength}-${Date.now()}"`;

    // Simplistic ETag handling
    if (c.req.header("if-none-match")) {
      return new Response(null, { status: 304 });
    }

    c.header("Content-Type", "application/rss+xml");
    c.header("ETag", etag);
    return c.body(xml);
  } catch (e) {
    return c.text("Not found", 404);
  }
}

app.get("/tech-blog.xml", (c) => serveFeed(c, "tech-blog.xml"));
app.get("/world-news.xml", (c) => serveFeed(c, "world-news.xml"));
app.get("/large-feed.xml", (c) => serveFeed(c, "large-feed.xml"));

app.get("/500-feed.xml", (c) => {
  return c.text("Internal Server Error", 500);
});

app.get("/timeout-feed.xml", async (c) => {
  await new Promise((resolve) => setTimeout(resolve, 35000)); // 35s timeout
  return c.text("Timeout", 504);
});

app.get("/health", (c) => c.json({ status: "ok" }));

export default {
  port: 3333,
  fetch: app.fetch,
};
