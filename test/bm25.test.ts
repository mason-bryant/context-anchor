import { describe, it, expect, beforeEach } from "vitest";
import { BM25Index } from "../src/bm25.js";

describe("BM25Index", () => {
  let index: BM25Index;

  beforeEach(() => {
    index = new BM25Index();
  });

  it("indexes and retrieves documents", () => {
    index.add({ id: "doc1", text: "user authentication login password" });
    index.add({ id: "doc2", text: "database migration schema tables" });
    index.add({ id: "doc3", text: "caching redis memcached performance" });

    const hits = index.search("redis");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].id).toBe("doc3");
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it("score is higher for more specific terms (IDF)", () => {
    index.add({ id: "doc1", text: "status update complete" });
    index.add({ id: "doc2", text: "status check pending" });
    index.add({ id: "doc3", text: "status report done" });
    index.add({ id: "doc4", text: "status overview summary" });
    index.add({ id: "doc5", text: "quasar deployment pipeline" });

    const hits = index.search("quasar");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].id).toBe("doc5");
  });

  it("remove updates the index", () => {
    index.add({ id: "doc1", text: "photosynthesis chlorophyll plants" });
    index.add({ id: "doc2", text: "database migration schema" });

    index.remove("doc1");
    const hits = index.search("photosynthesis");
    expect(hits).toEqual([]);
  });

  it("update replaces document content", () => {
    index.add({ id: "doc1", text: "materialization view query" });

    index.update({ id: "doc1", text: "permissions access control roles" });

    const materHits = index.search("materialization");
    expect(materHits).toEqual([]);

    const permHits = index.search("permissions");
    expect(permHits.length).toBeGreaterThan(0);
    expect(permHits[0].id).toBe("doc1");
  });

  it("search returns empty for unknown query", () => {
    index.add({ id: "doc1", text: "authentication login" });
    index.add({ id: "doc2", text: "database schema" });

    const hits = index.search("xylophone");
    expect(hits).toEqual([]);
  });

  it("acronym is findable in body text", () => {
    index.add({
      id: "projects/reporting-service/milestones/M1.md",
      text: "The quarterly_revenue_report (QRR) model needs restructuring to support new plan types",
    });
    index.add({
      id: "projects/other/context.md",
      text: "authentication permissions access control",
    });

    const hits = index.search("qrr");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].id).toBe("projects/reporting-service/milestones/M1.md");
  });

  it("size() reflects document count", () => {
    index.add({ id: "doc1", text: "first document" });
    index.add({ id: "doc2", text: "second document" });
    index.add({ id: "doc3", text: "third document" });
    expect(index.size()).toBe(3);

    index.remove("doc2");
    expect(index.size()).toBe(2);

    index.clear();
    expect(index.size()).toBe(0);
  });
});
