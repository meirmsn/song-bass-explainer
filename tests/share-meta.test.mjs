import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TITLE = "Song Bass Explainer - Understand Bass Lines in Songs";
const IMAGE = "https://bass.meirmsn.dev/social-preview.png";

function expectShareHead(html, ogUrl) {
  expect(html).toContain(`<title>${TITLE}</title>`);
  expect(html).toContain(`property="og:title" content="${TITLE}"`);
  expect(html).toContain(`property="og:image" content="${IMAGE}"`);
  expect(html).toContain(`property="og:url" content="${ogUrl}"`);
  expect(html).toContain(`name="twitter:card" content="summary_large_image"`);
  expect(html).toContain(`name="twitter:title" content="${TITLE}"`);
  expect(html).toContain(`name="twitter:image" content="${IMAGE}"`);
  expect(html).not.toMatch(/<title>[^<]*(gambling|Make Funk|Maple Leaf|Like a Prayer)/i);
  expect(html).not.toMatch(/property="og:title" content="[^"]*(gambling|Make Funk|Maple Leaf|Like a Prayer)/i);
  expect(html).not.toMatch(/name="twitter:title" content="[^"]*(gambling|Make Funk|Maple Leaf|Like a Prayer)/i);
  expect(html).not.toMatch(/property="og:image" content="(?!https:\/\/)/);
}

describe("public share meta", () => {
  it("homepage head uses the fixed title and absolute social preview", () => {
    const html = readFileSync(join(root, "public/index.html"), "utf8");
    expectShareHead(html, "https://bass.meirmsn.dev/");
  });

  it("/player/ head uses the same title and image", () => {
    const html = readFileSync(join(root, "public/player/index.html"), "utf8");
    expectShareHead(html, "https://bass.meirmsn.dev/player/");
  });

  it("static assets serve the packaging social-preview.png", () => {
    const docs = readFileSync(join(root, "docs/social-preview.png"));
    const pub = readFileSync(join(root, "public/social-preview.png"));
    expect(pub.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(createHash("sha256").update(pub).digest("hex")).toBe(
      createHash("sha256").update(docs).digest("hex"),
    );
  });

  it("player pins the public document title and never copies the song name into it", () => {
    const src = readFileSync(join(root, "public/js/player.js"), "utf8");
    expect(src).toContain(`const PUBLIC_PAGE_TITLE = "${TITLE}"`);
    expect(src).toContain("document.title = PUBLIC_PAGE_TITLE");
    expect(src).not.toMatch(/document\.title\s*=\s*[^;\n]*demo\.title/);
    expect(src).toContain('fetch("/api/demo/catalog")');
  });
});
