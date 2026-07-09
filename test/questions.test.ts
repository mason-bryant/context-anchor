import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AnchorService } from "../src/anchorService.js";
import { AnchorRepository } from "../src/git/repo.js";
import { deleteQuestion, extractQuestions, replaceQuestionText, setQuestionStatus } from "../src/questions.js";

const QUESTION_DOC = `---
type: context-anchor
---

# Demo

## Open Questions

- [ ] Q-1: Which storage backend owns questions?
- [x] Q-2: Should resolved questions remain queryable?
  Resolution: Yes, they remain useful as historical decision context.
  Resolved on: 2026-07-08
- [deferred] Q-3: Should the UI batch-edit questions?
  Owner: ux

## Resolved Questions

- Q-4: Did the parser ship?

\`\`\`
- [ ] Q-5: Fenced questions are ignored.
\`\`\`
`;

describe("questions", () => {
  it("extracts structured questions from question sections", () => {
    const questions = extractQuestions(QUESTION_DOC);

    expect(questions.map((question) => question.id)).toEqual(["Q-1", "Q-2", "Q-3", "Q-4"]);
    expect(questions.map((question) => question.status)).toEqual(["open", "resolved", "deferred", "resolved"]);
    expect(questions[1]).toMatchObject({
      text: "Should resolved questions remain queryable?",
      resolution: "Yes, they remain useful as historical decision context.",
      resolvedOn: "2026-07-08",
    });
    expect(questions[2]).toMatchObject({ owner: "ux" });
  });

  it("resolves and reopens a question while preserving non-metadata continuation lines", () => {
    const resolved = setQuestionStatus(
      `## Open Questions

- Q-1: Which source is canonical?
  Context note that should stay.
`,
      { id: "Q-1" },
      { status: "resolved", resolution: "The repo anchor is canonical.", resolvedOn: "2026-07-09" },
    );

    expect(resolved).toContain("- [x] Q-1: Which source is canonical?");
    expect(resolved).toContain("  Context note that should stay.");
    expect(resolved).toContain("  Resolution: The repo anchor is canonical.");
    expect(resolved).toContain("  Resolved on: 2026-07-09");

    const reopened = setQuestionStatus(resolved, { id: "Q-1" }, { status: "open" });
    expect(reopened).toContain("- [ ] Q-1: Which source is canonical?");
    expect(reopened).toContain("  Context note that should stay.");
    expect(reopened).not.toContain("Resolution:");
    expect(reopened).not.toContain("Resolved on:");

    const ownerPreserved = setQuestionStatus(
      `## Open Questions

- [ ] Q-2: Who owns the follow-up?
  Owner: platform
`,
      { id: "Q-2" },
      { status: "resolved", resolution: "Platform owns it.", resolvedOn: "2026-07-09" },
    );
    expect(ownerPreserved).toContain("  Owner: platform");
  });

  it("edits and deletes question text while preserving structured markers", () => {
    const edited = replaceQuestionText(QUESTION_DOC, { id: "Q-1" }, "Which storage backend should own questions?");

    expect(edited).toContain("- [ ] Q-1: Which storage backend should own questions?");
    expect(edited).not.toContain("Which storage backend owns questions?");

    const deleted = deleteQuestion(edited, { id: "Q-2" });
    expect(deleted).not.toContain("Q-2");
    expect(deleted).not.toContain("Resolution: Yes, they remain useful");
    expect(extractQuestions(deleted).map((question) => question.id)).toEqual(["Q-1", "Q-3", "Q-4"]);
  });
});

describe("AnchorService questions", () => {
  let tmpDir: string;
  let repo: AnchorRepository;
  let service: AnchorService;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-questions-"));
    repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("lists, resolves, and reopens questions in anchors", async () => {
    const write = await service.writeAnchor({
      name: "projects/demo/questions-demo.md",
      content: anchorContent(),
      message: "test: add questions demo",
    });
    expect(write.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);

    const all = await service.listQuestions({ project: "demo" });
    expect(all.summary).toEqual({ total: 3, open: 2, resolved: 1, deferred: 0, "wont-answer": 0 });
    expect(all.questions.map((question) => question.id)).toEqual(["Q-1", "Q-2", undefined]);

    const filtered = await service.listQuestions({ project: "demo", status: "resolved", q: "historical" });
    expect(filtered.questions.map((question) => question.id)).toEqual(["Q-2"]);
    expect(filtered.summary.total).toBe(3);

    const resolved = await service.resolveQuestion({
      name: "projects/demo/questions-demo.md",
      id: "Q-1",
      resolution: "Store them as structured markdown-backed questions.",
      resolvedOn: "2026-07-09",
    });
    expect(resolved.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
    expect(resolved.version).toBeTruthy();

    const afterResolve = await service.listQuestions({ name: "projects/demo/questions-demo.md" });
    expect(afterResolve.summary).toEqual({ total: 3, open: 1, resolved: 2, deferred: 0, "wont-answer": 0 });
    expect(afterResolve.questions.find((question) => question.id === "Q-1")).toMatchObject({
      status: "resolved",
      resolution: "Store them as structured markdown-backed questions.",
      resolvedOn: "2026-07-09",
    });

    const reopened = await service.reopenQuestion({ name: "projects/demo/questions-demo.md", id: "Q-1" });
    expect(reopened.version).toBeTruthy();

    const afterReopen = await service.listQuestions({ name: "projects/demo/questions-demo.md" });
    const q1 = afterReopen.questions.find((question) => question.id === "Q-1");
    expect(q1).toMatchObject({ status: "open" });
    expect(q1?.resolution).toBeUndefined();

    const edited = await service.updateQuestionText({
      name: "projects/demo/questions-demo.md",
      id: "Q-1",
      text: "Should open questions be editable in the UI?",
      approved: true,
    });
    expect(edited.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
    const afterEdit = await service.listQuestions({ name: "projects/demo/questions-demo.md", q: "editable" });
    expect(afterEdit.questions[0]).toMatchObject({ id: "Q-1", text: "Should open questions be editable in the UI?" });

    const deleteBlocked = await service.updateQuestionText({
      name: "projects/demo/questions-demo.md",
      id: "Q-1",
      delete: true,
    });
    expect(deleteBlocked.warnings[0]?.code).toBe("requires_approval");

    const deleted = await service.updateQuestionText({
      name: "projects/demo/questions-demo.md",
      id: "Q-1",
      delete: true,
      approved: true,
    });
    expect(deleted.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
    const afterDelete = await service.listQuestions({ name: "projects/demo/questions-demo.md" });
    expect(afterDelete.questions.map((question) => question.id)).toEqual(["Q-2", undefined]);
  });

  it("returns typed blocks for missing or ambiguous question targets", async () => {
    await service.writeAnchor({
      name: "projects/demo/questions-demo.md",
      content: anchorContent(),
      message: "test: add questions demo",
    });

    const missingTarget = await service.resolveQuestion({ name: "projects/demo/questions-demo.md" });
    expect(missingTarget.warnings[0]?.code).toBe("question_target_missing");

    const missing = await service.resolveQuestion({ name: "projects/demo/questions-demo.md", id: "Q-999" });
    expect(missing.warnings[0]?.code).toBe("question_not_found");

    const invalidId = await service.resolveQuestion({ name: "projects/demo/questions-demo.md", id: "not-a-question-id" });
    expect(invalidId.warnings[0]?.code).toBe("question_not_found");

    const ambiguous = await service.resolveQuestion({ name: "projects/demo/questions-demo.md", question: "Should" });
    expect(ambiguous.warnings[0]?.code).toBe("question_ambiguous");
  });
});

function anchorContent(): string {
  const today = localDateKey();
  return `---
project:
  - demo
type: context-anchor
tags:
  - questions
summary: "Questions test anchor."
read_this_if:
  - "You are testing question handling."
last_validated: ${today}
---

# Questions Demo

## Current State

- The questions test anchor exists.

## Decisions

- None.

## Constraints

- None.

## Open Questions

- [ ] Q-1: Should open questions be data?
- [x] Q-2: Should resolved questions remain queryable?
  Resolution: Yes, they are historical context.
  Resolved on: 2026-07-08
- Should question bullets work without ids?

## PRs

None.
`;
}

function localDateKey(): string {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
