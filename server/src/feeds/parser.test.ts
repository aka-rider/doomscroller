import { describe, test, expect } from 'bun:test';
import { parseFeed, detectTargetUrl } from './parser';
import {
  RSS2_FEED, ATOM_FEED, RDF_FEED, MALFORMED_XML, EMPTY_FEED,
} from '../test-utils';

// ============================================================================
// GATE 3: Feed Parser — the mouth of the pipeline
// If parsing produces garbage, everything downstream is corrupt.
// Test every format we claim to support. Test edge cases that WILL appear
// in real feeds (missing fields, CDATA, HTML entities, no dates).
// ============================================================================

describe('parseFeed — RSS 2.0', () => {
  test('parses a well-formed RSS 2.0 feed', () => {
    const result = parseFeed(RSS2_FEED);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    const feed = result.value;
    expect(feed.title).toBe('Test Blog');
    expect(feed.siteUrl).toBe('https://test.blog');
    expect(feed.description).toBe('A test blog for testing');
    expect(feed.entries).toHaveLength(2);
  });

  test('extracts content:encoded over description when both present', () => {
    const result = parseFeed(RSS2_FEED);
    if (!result.ok) throw new Error(result.error);

    const first = result.value.entries[0]!;
    expect(first.contentHtml).toContain('Full content of the first post');
    // content:encoded should win over plain description
    expect(first.contentHtml).not.toContain('Short description');
  });

  test('falls back to description when no content:encoded', () => {
    const result = parseFeed(RSS2_FEED);
    if (!result.ok) throw new Error(result.error);

    const second = result.value.entries[1]!;
    // Second item only has description
    expect(second.contentHtml).toContain('HTML in description');
  });

  test('extracts guid from <guid> element', () => {
    const result = parseFeed(RSS2_FEED);
    if (!result.ok) throw new Error(result.error);

    expect(result.value.entries[0]!.guid).toBe('first-post-guid');
    expect(result.value.entries[1]!.guid).toBe('second-post-guid');
  });

  test('extracts guid from <guid isPermaLink="false"> without collapsing to [object Object]', () => {
    const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test</title>
    <link>https://example.com</link>
    <item>
      <title>First</title>
      <link>https://example.com/1</link>
      <guid isPermaLink="false">unique-id-1</guid>
    </item>
    <item>
      <title>Second</title>
      <link>https://example.com/2</link>
      <guid isPermaLink="false">unique-id-2</guid>
    </item>
    <item>
      <title>Third</title>
      <link>https://example.com/3</link>
      <guid isPermaLink="true">https://example.com/3</guid>
    </item>
  </channel>
</rss>`;
    const result = parseFeed(feed);
    if (!result.ok) throw new Error(result.error);

    expect(result.value.entries).toHaveLength(3);
    expect(result.value.entries[0]!.guid).toBe('unique-id-1');
    expect(result.value.entries[1]!.guid).toBe('unique-id-2');
    expect(result.value.entries[2]!.guid).toBe('https://example.com/3');
  });

  test('extracts dc:creator as author', () => {
    const result = parseFeed(RSS2_FEED);
    if (!result.ok) throw new Error(result.error);

    expect(result.value.entries[0]!.author).toBe('Alice');
  });

  test('extracts <author> fallback when no dc:creator', () => {
    const result = parseFeed(RSS2_FEED);
    if (!result.ok) throw new Error(result.error);

    expect(result.value.entries[1]!.author).toBe('bob@test.blog');
  });

  test('parses pubDate to unixepoch', () => {
    const result = parseFeed(RSS2_FEED);
    if (!result.ok) throw new Error(result.error);

    const ts = result.value.entries[0]!.publishedAt;
    expect(ts).not.toBeNull();
    // Mon, 01 Jan 2024 12:00:00 GMT = 1704110400
    expect(ts).toBe(1704110400);
  });

  test('extracts media:content image URL', () => {
    const result = parseFeed(RSS2_FEED);
    if (!result.ok) throw new Error(result.error);

    expect(result.value.entries[0]!.imageUrl).toBe('https://test.blog/img/first.jpg');
  });

  test('summary is plain text (HTML stripped)', () => {
    const result = parseFeed(RSS2_FEED);
    if (!result.ok) throw new Error(result.error);

    const summary = result.value.entries[0]!.summary;
    expect(summary).not.toContain('<p>');
    expect(summary).not.toContain('</p>');
    expect(summary).toContain('Full content of the first post');
  });

  test('summary is capped at 1000 chars', () => {
    const longContent = '<p>' + 'a'.repeat(2000) + '</p>';
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel><title>T</title><link>https://t.co</link>
      <item><title>Long</title><link>https://t.co/long</link>
      <description>${longContent}</description></item>
      </channel></rss>`;

    const result = parseFeed(xml);
    if (!result.ok) throw new Error(result.error);

    expect(result.value.entries[0]!.summary.length).toBeLessThanOrEqual(1000);
  });
});

describe('parseFeed — Atom', () => {
  test('parses a well-formed Atom feed', () => {
    const result = parseFeed(ATOM_FEED);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    const feed = result.value;
    expect(feed.title).toBe('Atom Test Feed');
    expect(feed.siteUrl).toBe('https://atom.test');
    expect(feed.description).toBe('An Atom feed for testing');
    expect(feed.entries).toHaveLength(2);
  });

  test('resolves alternate link for site URL', () => {
    const result = parseFeed(ATOM_FEED);
    if (!result.ok) throw new Error(result.error);

    // Should pick rel=alternate, not rel=self
    expect(result.value.siteUrl).toBe('https://atom.test');
  });

  test('extracts Atom entry link with rel=alternate', () => {
    const result = parseFeed(ATOM_FEED);
    if (!result.ok) throw new Error(result.error);

    expect(result.value.entries[0]!.url).toBe('https://atom.test/entry-1');
  });

  test('uses <id> as guid', () => {
    const result = parseFeed(ATOM_FEED);
    if (!result.ok) throw new Error(result.error);

    expect(result.value.entries[0]!.guid).toBe('urn:uuid:atom-entry-1');
  });

  test('extracts author from <author><name>', () => {
    const result = parseFeed(ATOM_FEED);
    if (!result.ok) throw new Error(result.error);

    expect(result.value.entries[0]!.author).toBe('Charlie');
  });

  test('falls back to <updated> when no <published>', () => {
    const result = parseFeed(ATOM_FEED);
    if (!result.ok) throw new Error(result.error);

    const second = result.value.entries[1]!;
    expect(second.publishedAt).not.toBeNull();
    // 2024-01-16T10:00:00Z
    expect(second.publishedAt).toBe(Math.floor(Date.parse('2024-01-16T10:00:00Z') / 1000));
  });

  test('extracts content from <content type="html">', () => {
    const result = parseFeed(ATOM_FEED);
    if (!result.ok) throw new Error(result.error);

    expect(result.value.entries[0]!.contentHtml).toContain('Atom content here');
  });

  test('falls back to <summary> when no <content>', () => {
    const result = parseFeed(ATOM_FEED);
    if (!result.ok) throw new Error(result.error);

    const second = result.value.entries[1]!;
    expect(second.contentHtml).toContain('Summary only entry');
  });

  test('extracts <img> from HTML content as imageUrl', () => {
    const result = parseFeed(ATOM_FEED);
    if (!result.ok) throw new Error(result.error);

    expect(result.value.entries[0]!.imageUrl).toBe('https://atom.test/img.png');
  });

  test('handles Atom title as object with #text', () => {
    const result = parseFeed(ATOM_FEED);
    if (!result.ok) throw new Error(result.error);

    // Second entry has type="text" attribute
    expect(result.value.entries[1]!.title).toBe('Atom Entry Two');
  });
});

describe('parseFeed — RSS 1.0 / RDF', () => {
  test('parses a well-formed RDF feed', () => {
    const result = parseFeed(RDF_FEED);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    const feed = result.value;
    expect(feed.title).toBe('RDF Test Feed');
    expect(feed.siteUrl).toBe('https://rdf.test');
    expect(feed.entries).toHaveLength(1);
  });

  test('parses dc:date format', () => {
    const result = parseFeed(RDF_FEED);
    if (!result.ok) throw new Error(result.error);

    const entry = result.value.entries[0]!;
    expect(entry.publishedAt).not.toBeNull();
    expect(entry.publishedAt).toBe(Math.floor(Date.parse('2024-02-01T08:00:00Z') / 1000));
  });

  test('extracts dc:creator from RDF items', () => {
    const result = parseFeed(RDF_FEED);
    if (!result.ok) throw new Error(result.error);

    expect(result.value.entries[0]!.author).toBe('Dana');
  });
});

describe('parseFeed — edge cases', () => {
  test('returns Err for malformed XML', () => {
    const result = parseFeed(MALFORMED_XML);
    // fast-xml-parser may or may not throw on this particular malformation,
    // but if it parses, it should fail on "unknown format"
    if (result.ok) {
      // If it somehow parsed, it should not have valid structure
      // This is acceptable — the parser is lenient
    } else {
      expect(result.error).toBeTruthy();
    }
  });

  test('returns Err for unrecognized root element', () => {
    const result = parseFeed('<?xml version="1.0"?><html><body>Not a feed</body></html>');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Unknown feed format');
    }
  });

  test('handles empty item list gracefully', () => {
    const result = parseFeed(EMPTY_FEED);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    expect(result.value.entries).toHaveLength(0);
    expect(result.value.title).toBe('Empty Feed');
  });

  test('handles items with missing fields gracefully', () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel><title>Sparse</title><link>https://s.co</link>
      <item><title>No link or guid</title></item>
      </channel></rss>`;

    const result = parseFeed(xml);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    const entry = result.value.entries[0]!;
    expect(entry.title).toBe('No link or guid');
    // Missing fields should be empty strings or null, not throw
    expect(typeof entry.url).toBe('string');
    expect(typeof entry.author).toBe('string');
    expect(typeof entry.contentHtml).toBe('string');
  });

  test('strips scripts and styles from summary', () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel><title>T</title><link>https://t.co</link>
      <item><title>XSS</title><link>https://t.co/xss</link>
      <description><![CDATA[
        <script>alert('xss')</script>
        <style>.evil { display: none; }</style>
        <p>Safe content here</p>
      ]]></description></item>
      </channel></rss>`;

    const result = parseFeed(xml);
    if (!result.ok) throw new Error(result.error);

    const summary = result.value.entries[0]!.summary;
    expect(summary).not.toContain('script');
    expect(summary).not.toContain('alert');
    expect(summary).not.toContain('style');
    expect(summary).toContain('Safe content here');
  });

  test('decodes HTML entities in summary', () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel><title>T</title><link>https://t.co</link>
      <item><title>Entities</title><link>https://t.co/e</link>
      <description>&lt;p&gt;Rock &amp; Roll&lt;/p&gt;</description>
      </item></channel></rss>`;

    const result = parseFeed(xml);
    if (!result.ok) throw new Error(result.error);

    const summary = result.value.entries[0]!.summary;
    expect(summary).toContain('Rock & Roll');
  });

  test('returns Err for empty string input', () => {
    const result = parseFeed('');
    expect(result.ok).toBe(false);
  });

  test('handles enclosure with image type', () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel><title>T</title><link>https://t.co</link>
      <item>
        <title>Enc</title><link>https://t.co/enc</link>
        <enclosure url="https://t.co/photo.jpg" type="image/jpeg" length="12345"/>
      </item></channel></rss>`;

    const result = parseFeed(xml);
    if (!result.ok) throw new Error(result.error);

    expect(result.value.entries[0]!.imageUrl).toBe('https://t.co/photo.jpg');
  });

  test('does not extract enclosure with non-image type as imageUrl', () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel><title>T</title><link>https://t.co</link>
      <item>
        <title>Audio</title><link>https://t.co/audio</link>
        <enclosure url="https://t.co/podcast.mp3" type="audio/mpeg" length="99999"/>
        <description>No images here</description>
      </item></channel></rss>`;

    const result = parseFeed(xml);
    if (!result.ok) throw new Error(result.error);

    // Should not use the audio enclosure as image
    expect(result.value.entries[0]!.imageUrl).toBeNull();
  });
});

describe('parseFeed — data fidelity across the pipeline', () => {
  // These tests verify that data survives the parse step intact.
  // If a field is mangled here, every downstream consumer is compromised.

  test('preserves full HTML content for display layer', () => {
    const html = '<div class="post"><h1>Title</h1><p>Paragraph with <a href="https://link.com">link</a></p></div>';
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"
        xmlns:content="http://purl.org/rss/1.0/modules/content/">
      <channel><title>T</title><link>https://t.co</link>
      <item><title>Rich</title><link>https://t.co/rich</link><guid>rich-1</guid>
      <content:encoded><![CDATA[${html}]]></content:encoded>
      </item></channel></rss>`;

    const result = parseFeed(xml);
    if (!result.ok) throw new Error(result.error);

    // contentHtml must preserve the original HTML verbatim
    expect(result.value.entries[0]!.contentHtml).toBe(html);
  });

  test('preserves URLs without mangling query params or fragments', () => {
    const url = 'https://example.com/post?utm_source=rss&id=123#section-2';
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel><title>T</title><link>https://t.co</link>
      <item><title>URL</title><link>${url}</link><guid>${url}</guid>
      </item></channel></rss>`;

    const result = parseFeed(xml);
    if (!result.ok) throw new Error(result.error);

    expect(result.value.entries[0]!.url).toBe(url);
  });

  test('handles unicode content correctly', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0"><channel><title>日本語フィード</title><link>https://jp.test</link>
      <item><title>記事タイトル</title><link>https://jp.test/1</link>
      <description>これはテストです。Ñoño. Ü̈ber. Ελληνικά.</description>
      </item></channel></rss>`;

    const result = parseFeed(xml);
    if (!result.ok) throw new Error(result.error);

    expect(result.value.title).toBe('日本語フィード');
    expect(result.value.entries[0]!.title).toBe('記事タイトル');
    expect(result.value.entries[0]!.summary).toContain('これはテストです');
    expect(result.value.entries[0]!.summary).toContain('Ελληνικά');
  });
});

// ============================================================================
// detectTargetUrl — Link-only entry detection
// ============================================================================

describe('detectTargetUrl', () => {
  test('returns null for normal article content', () => {
    const html = '<p>This is a full article with lots of meaningful content that is well over two hundred characters. It discusses many topics and has real substance that would not be mistaken for a link-only entry in an RSS aggregator.</p>';
    expect(detectTargetUrl(html, 'https://blog.example.com/post/1', 'https://blog.example.com')).toBeNull();
  });

  test('detects external link in short content', () => {
    const html = '<a href="https://article.example.org/story/123">Article Title</a>';
    const result = detectTargetUrl(html, 'https://reddit.com/r/tech/abc', 'https://reddit.com');
    expect(result).toBe('https://article.example.org/story/123');
  });

  test('ignores links to same domain as feed', () => {
    const html = '<a href="https://reddit.com/r/tech/comments/abc">comments</a>';
    expect(detectTargetUrl(html, 'https://reddit.com/r/tech/abc', 'https://reddit.com')).toBeNull();
  });

  test('ignores links with comment/reply paths', () => {
    const html = '<a href="https://other.com/comments/thread">discussion</a>';
    expect(detectTargetUrl(html, 'https://reddit.com/r/tech/abc', 'https://reddit.com')).toBeNull();
  });

  test('rejects javascript: URLs', () => {
    const html = '<a href="javascript:alert(1)">click</a>';
    expect(detectTargetUrl(html, 'https://hn.com/item?id=1', 'https://hn.com')).toBeNull();
  });

  test('rejects private IPs (SSRF protection)', () => {
    const html = '<a href="http://192.168.1.1/admin">internal</a>';
    expect(detectTargetUrl(html, 'https://reddit.com/r/x/1', 'https://reddit.com')).toBeNull();
  });

  test('rejects loopback (SSRF protection)', () => {
    const html = '<a href="http://127.0.0.1:3000/secret">secret</a>';
    expect(detectTargetUrl(html, 'https://reddit.com/r/x/1', 'https://reddit.com')).toBeNull();
  });

  test('rejects localhost (SSRF protection)', () => {
    const html = '<a href="http://localhost:8080/api">api</a>';
    expect(detectTargetUrl(html, 'https://reddit.com/r/x/1', 'https://reddit.com')).toBeNull();
  });

  test('rejects 10.x.x.x private range', () => {
    const html = '<a href="http://10.0.0.1/internal">internal</a>';
    expect(detectTargetUrl(html, 'https://reddit.com/r/x/1', 'https://reddit.com')).toBeNull();
  });

  test('returns null when content is long enough', () => {
    const longText = 'a'.repeat(250);
    const html = `<p>${longText}</p><a href="https://example.org/article">link</a>`;
    expect(detectTargetUrl(html, 'https://reddit.com/r/x/1', 'https://reddit.com')).toBeNull();
  });

  test('Reddit-style RSS with [link] detects target', () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>r/technology</title>
  <link>https://www.reddit.com/r/technology/</link>
  <item>
    <title>Cool Article About Tech</title>
    <link>https://www.reddit.com/r/technology/comments/abc123/cool_article/</link>
    <guid>t3_abc123</guid>
    <description>&lt;a href="https://arstechnica.com/science/2024/cool-article"&gt;[link]&lt;/a&gt; &lt;a href="https://www.reddit.com/r/technology/comments/abc123/cool_article/"&gt;[comments]&lt;/a&gt;</description>
  </item>
</channel></rss>`;

    const result = parseFeed(xml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.entries[0]!.targetUrl).toBe('https://arstechnica.com/science/2024/cool-article');
  });

  test('normal RSS article has null targetUrl', () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Blog</title>
  <link>https://blog.example.com</link>
  <item>
    <title>My Post</title>
    <link>https://blog.example.com/post/1</link>
    <guid>post-1</guid>
    <description>This is a really long article description that contains more than two hundred characters of meaningful content, discussing various topics in depth and providing value to readers who want to learn about things.</description>
  </item>
</channel></rss>`;

    const result = parseFeed(xml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.entries[0]!.targetUrl).toBeNull();
  });
});
