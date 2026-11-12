import { expect, test } from "bun:test";
import { createApprovals } from "../src/chat/approval";
import type { ApprovalRequest } from "../src/chat/contracts";

const action: ApprovalRequest = {
  name: "run_command", preview: { type: "command", command: "echo example", cwd: "/project", shell: "sh" },
};

test("aborted approvals settle as denied and never become visible again", async () => {
  const approvals = createApprovals();
  const abort = new AbortController();
  const pending = approvals.request(action, abort.signal);
  expect(approvals.pending).toBe(action);
  abort.abort();
  approvals.answer(true);
  expect(await pending).toBe(false);
  expect(approvals.pending).toBeUndefined();
  expect(await approvals.request(action, abort.signal)).toBe(false);
  expect(approvals.pending).toBeUndefined();
});

test("each answer settles only its visible request and releases the old abort listener", async () => {
  const approvals = createApprovals();
  const firstAbort = new AbortController();
  const first = approvals.request(action, firstAbort.signal);
  const secondAbort = new AbortController();
  expect(await approvals.request({ ...action, name: "another-command" }, secondAbort.signal)).toBe(false);
  expect(approvals.pending).toBe(action);
  approvals.answer(true);
  approvals.answer(false);
  expect(await first).toBe(true);
  const next = approvals.request(action, secondAbort.signal);
  firstAbort.abort();
  expect(approvals.pending).toBe(action);
  approvals.answer(false);
  expect(await next).toBe(false);
  expect(approvals.pending).toBeUndefined();
});
