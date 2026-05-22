import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { UI_CSS, UI_HTML, UI_JS } from "../src/ui/assets.js";

type UiAssetHooks = {
  renderMarkdown(markdown: string): string;
  sanitizeLinkHref(href: string): string | null;
  anchorHref(name: string): string;
  readAnchorFromLocation(): string | null;
  token(): string;
  saveToken(value: string): void;
  renderAnchorRow(anchor: Record<string, unknown>): string;
  shouldHandleClientNavigation(event: Record<string, unknown>, link: { getAttribute(name: string): string | null }): boolean;
};

type TestStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function createStorage(initial: Record<string, string> = {}): TestStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function loadHooks(
  options: { search?: string; hash?: string; localStorage?: TestStorage; sessionStorage?: TestStorage } = {},
): UiAssetHooks {
  const hooks: Partial<UiAssetHooks> = {};
  const search = options.search ?? "";
  const hash = options.hash ?? "";
  const localStorage = options.localStorage ?? createStorage();
  const sessionStorage = options.sessionStorage ?? createStorage();

  vm.runInNewContext(UI_JS, {
    URL,
    URLSearchParams,
    decodeURIComponent,
    window: {
      location: {
        href: `http://localhost:3333/ui${search}${hash}`,
        search,
        hash,
        origin: "http://localhost:3333",
        pathname: "/ui",
      },
      localStorage,
      sessionStorage,
      __ANCHOR_MCP_UI_TEST_HOOKS__: hooks,
    },
  });

  return hooks as UiAssetHooks;
}

describe("UI browser assets", () => {
  it("provides a small monochrome icon library for core controls", () => {
    expect(UI_HTML).toContain('id="icon-home"');
    expect(UI_HTML).toContain('id="icon-anchor"');
    expect(UI_HTML).toContain('id="icon-filter"');
    expect(UI_HTML).toContain('id="icon-save"');
    expect(UI_HTML).toContain('<use href="#icon-home"></use>');
    expect(UI_HTML).toContain('<use href="#icon-anchor"></use>');
    expect(UI_HTML).toContain('<use href="#icon-filter"></use>');
    expect(UI_HTML).toContain('<use href="#icon-save"></use>');
    expect(UI_CSS).toContain("stroke: currentColor");
  });

  it("persists bearer tokens in localStorage for same-origin tabs", () => {
    const sharedLocalStorage = createStorage();
    const firstTab = loadHooks({ localStorage: sharedLocalStorage });
    firstTab.saveToken(" test-token ");

    const secondTab = loadHooks({ localStorage: sharedLocalStorage });

    expect(secondTab.token()).toBe("test-token");
  });

  it("migrates existing session bearer tokens to localStorage", () => {
    const localStorage = createStorage();
    const sessionStorage = createStorage({ "anchor-mcp-token": "old-session-token" });
    const hooks = loadHooks({ localStorage, sessionStorage });

    expect(hooks.token()).toBe("old-session-token");
    expect(localStorage.getItem("anchor-mcp-token")).toBe("old-session-token");
  });

  it("does not apply inline-code highlighting inside fenced code blocks", () => {
    expect(UI_CSS).toContain(".markdown pre code");
    expect(UI_CSS).toContain("background: transparent");
    expect(UI_CSS).toContain("color: inherit");
  });

  it("neutralizes unsafe markdown link schemes", () => {
    const hooks = loadHooks();
    const html = hooks.renderMarkdown(
      "[bad](javascript:alert(1)) [data](data:text/html,pwn) [protocol](//example.test) [ok](https://example.test) [mail](mailto:a@example.test) [rel](projects/demo/demo.md)",
    );

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text");
    expect(html).not.toContain('href="//example.test');
    expect(html).toContain("Unsafe link removed");
    expect(html).toContain('href="https://example.test"');
    expect(html).toContain('href="mailto:a@example.test"');
    expect(html).toContain('href="projects/demo/demo.md"');
  });

  it("rejects obfuscated unsafe link protocols", () => {
    const hooks = loadHooks();

    expect(hooks.sanitizeLinkHref("java\nscript:alert(1)")).toBeNull();
    expect(hooks.sanitizeLinkHref(" data:text/html,pwn")).toBeNull();
    expect(hooks.sanitizeLinkHref("https://example.test/path")).toBe("https://example.test/path");
  });

  it("builds and reads durable anchor query links", () => {
    const hooks = loadHooks({ search: "?anchor=server-rules%2Facceptance-criteria.md" });

    expect(hooks.anchorHref("server-rules/acceptance-criteria.md")).toBe(
      "?anchor=server-rules%2Facceptance-criteria.md",
    );
    expect(hooks.readAnchorFromLocation()).toBe("server-rules/acceptance-criteria.md");
  });

  it("still reads legacy hash anchor links", () => {
    const hooks = loadHooks({ hash: "#anchor=projects%2Fdemo%2Fdemo.md" });

    expect(hooks.readAnchorFromLocation()).toBe("projects/demo/demo.md");
  });

  it("renders anchor list rows as durable links", () => {
    const hooks = loadHooks();
    const html = hooks.renderAnchorRow({
      name: "projects/demo/demo.md",
      category: "projects",
      projectSlug: "demo",
      summary: "Demo anchor summary.",
      ui: {
        label: "Demo Anchor",
        health: { status: "ok" },
      },
    });

    expect(html).toContain('<a class="anchor-row" href="?anchor=projects%2Fdemo%2Fdemo.md"');
    expect(html).toContain('<use href="#icon-anchor"></use>');
    expect(html).toContain('data-name="projects/demo/demo.md"');
    expect(html).not.toContain("<button");
  });

  it("only intercepts plain same-tab anchor navigation", () => {
    const hooks = loadHooks();
    const sameTabLink = { getAttribute: () => "" };
    const blankTargetLink = { getAttribute: () => "_blank" };

    expect(hooks.shouldHandleClientNavigation({ button: 0 }, sameTabLink)).toBe(true);
    expect(hooks.shouldHandleClientNavigation({ button: 1 }, sameTabLink)).toBe(false);
    expect(hooks.shouldHandleClientNavigation({ button: 0, metaKey: true }, sameTabLink)).toBe(false);
    expect(hooks.shouldHandleClientNavigation({ button: 0, ctrlKey: true }, sameTabLink)).toBe(false);
    expect(hooks.shouldHandleClientNavigation({ button: 0 }, blankTargetLink)).toBe(false);
  });
});
