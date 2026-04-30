import { Hono } from "hono";

const app = new Hono();

function hashToVector(text: string): number[] {
  const vec = new Array(768).fill(0);
  const words = text.toLowerCase().split(/\s+/);

  const techKeywords = ["programming", "algorithm", "api", "code", "ml", "neural", "rust", "database", "systems"];
  const newsKeywords = ["politics", "economy", "climate", "election", "trade", "presidential", "international", "un"];

  let isTech = false;
  let isNews = false;

  for (const word of words) {
    if (techKeywords.some(kw => word.includes(kw))) isTech = true;
    if (newsKeywords.some(kw => word.includes(kw))) isNews = true;
  }

  // Deterministic deterministic vectors
  for (let i = 0; i < 768; i++) {
    let val = 0;
    if (isTech) {
      val = Math.sin(i * 0.1) * 0.5 + 0.1;
    } else if (isNews) {
      val = Math.cos(i * 0.1) * 0.5 - 0.1;
    } else {
      val = Math.sin(text.length + i) * 0.1;
    }
    // Normalize roughly
    vec[i] = val;
  }
  return vec;
}

app.post("/v1/embeddings", async (c) => {
  const body = await c.req.json();
  const inputs = Array.isArray(body.input) ? body.input : [body.input];

  const data = inputs.map((text: string, index: number) => ({
    embedding: hashToVector(text),
    index
  }));

  return c.json({ data });
});

app.get("/health", (c) => c.json({ status: "ok" }));

export default {
  port: 8081,
  fetch: app.fetch,
};
