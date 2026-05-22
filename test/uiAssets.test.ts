import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { UI_CSS, UI_HTML, UI_JS } from "../src/ui/assets.js";

type UiAssetHooks = {
  renderMarkdown(markdown: string): string;
  sanitizeLinkHref(href: string): string | null;
  anchorHref(name: string): string;
  readAnchorFromLocation(): string | null;
  clearAnchorLocation(): void;
  showSelectedAnchor(): void;
  setSelectedNameForTest(name: string | null): void;
  token(): string;
  storeToken(value: string): void;
  shouldHandleAnchorLinkInApp(
    event: {
      defaultPrevented?: boolean;
      button?: number;
      metaKey?: boolean;
      ctrlKey?: boolean;
      shiftKey?: boolean;
      altKey?: boolean;
    },
    link: { getAttribute(name: string): string | null },
  ): boolean;
};

type FakeStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function storage(initial: Record<string, string> = {}): FakeStorage {
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
  options: {
    search?: string;
    hash?: string;
    sessionStorage?: FakeStorage;
    localStorage?: FakeStorage;
    historyUpdates?: string[];
  } = {},
): UiAssetHooks {
  const hooks: Partial<UiAssetHooks> = {};
  const search = options.search ?? "";
  const hash = options.hash ?? "";
  const sessionStorage = options.sessionStorage ?? storage();
  const localStorage = options.localStorage ?? storage();

  vm.runInNewContext(UI_JS, {
    URL,
    URLSearchParams,
    decodeURIComponent,
    document: {
      querySelectorAll: () => [],
    },
    window: {
      location: {
        href: `http://localhost:3333/ui${search}${hash}`,
        search,
        hash,
        origin: "http://localhost:3333",
        pathname: "/ui",
      },
      sessionStorage,
      localStorage,
      history: {
        pushState: (_state: unknown, _title: string, url: string) => {
          options.historyUpdates?.push(url);
        },
      },
      __ANCHOR_MCP_UI_TEST_HOOKS__: hooks,
    },
  });

  return hooks as UiAssetHooks;
}

describe("UI browser assets", () => {
  it("labels the detail tab as a disabled selected-anchor tab", () => {
    expect(UI_HTML).toContain("Selected Anchor");
    expect(UI_HTML).toContain('data-tab="detail" type="button" disabled');
  });

  it("keeps fenced code blocks readable when inline code styles exist", () => {
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

  it("clears the anchor query when returning to context root", () => {
    const historyUpdates: string[] = [];
    const hooks = loadHooks({
      search: "?project=demo&anchor=projects%2Fdemo%2Fdemo.md",
      historyUpdates,
    });

    hooks.clearAnchorLocation();

    expect(historyUpdates).toEqual(["/ui?project=demo"]);
  });

  it("restores the selected-anchor route when returning to detail", () => {
    const historyUpdates: string[] = [];
    const hooks = loadHooks({ historyUpdates });

    hooks.showSelectedAnchor();
    expect(historyUpdates).toEqual([]);

    hooks.setSelectedNameForTest("projects/demo/demo.md");
    hooks.showSelectedAnchor();
    expect(historyUpdates).toEqual(["/ui?anchor=projects%2Fdemo%2Fdemo.md"]);
  });

  it("still reads legacy hash anchor links", () => {
    const hooks = loadHooks({ hash: "#anchor=projects%2Fdemo%2Fdemo.md" });

    expect(hooks.readAnchorFromLocation()).toBe("projects/demo/demo.md");
  });

  it("keeps browser-native new-tab gestures for internal anchor links", () => {
    const hooks = loadHooks();
    const link = { getAttribute: () => null };

    expect(hooks.shouldHandleAnchorLinkInApp({ button: 0 }, link)).toBe(true);
    expect(hooks.shouldHandleAnchorLinkInApp({ button: 0, metaKey: true }, link)).toBe(false);
    expect(hooks.shouldHandleAnchorLinkInApp({ button: 0, ctrlKey: true }, link)).toBe(false);
    expect(hooks.shouldHandleAnchorLinkInApp({ button: 0, shiftKey: true }, link)).toBe(false);
    expect(hooks.shouldHandleAnchorLinkInApp({ button: 1 }, link)).toBe(false);
    expect(hooks.shouldHandleAnchorLinkInApp({ button: 0 }, { getAttribute: () => "_blank" })).toBe(false);
  });

  it("shares stored auth token across same-origin UI tabs", () => {
    const localStorage = storage({ "anchor-mcp-token": "shared-token" });
    const sessionStorage = storage();
    const hooks = loadHooks({ localStorage, sessionStorage });

    expect(hooks.token()).toBe("shared-token");
    hooks.storeToken("new-token");
    expect(localStorage.getItem("anchor-mcp-token")).toBe("new-token");
    expect(sessionStorage.getItem("anchor-mcp-token")).toBe("new-token");

    hooks.storeToken("");
    expect(localStorage.getItem("anchor-mcp-token")).toBeNull();
    expect(sessionStorage.getItem("anchor-mcp-token")).toBeNull();
  });

  it("migrates an existing tab token into shared storage", () => {
    const localStorage = storage();
    const sessionStorage = storage({ "anchor-mcp-token": "legacy-session-token" });
    const hooks = loadHooks({ localStorage, sessionStorage });

    expect(hooks.token()).toBe("legacy-session-token");
    expect(localStorage.getItem("anchor-mcp-token")).toBe("legacy-session-token");
  });
});
