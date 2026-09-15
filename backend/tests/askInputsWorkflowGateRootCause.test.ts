/**
 * P0 QA root cause 16/09/2026: the #98 ask_inputs gate was dead code —
 * workflowStore is ALWAYS seeded with the 10 built-in workflows, so
 * `(workflowStore?.size ?? 0) > 0` was always true and ask_inputs was
 * never filtered, the pause never blocked (stochastic R11 picker).
 *
 * Mechanism contract, both gates:
 *   streaming:  ask_inputs advertised only when docs attached OR the user
 *               SELECTED a workflow (the "[Workflow:" marker that
 *               buildMessages injects only for msg.workflow).
 *   dispatcher: ask_inputs pause for choice-only items allowed only under
 *               the same conditions — a store full of built-ins does NOT
 *               qualify (SYSTEM_WORKFLOW_IDS filter).
 */
import { describe, it, expect } from "vitest";
import { shouldEmitAskInputsPause } from "../src/lib/chat/tools/toolDispatcher";
import { SYSTEM_ASSISTANT_WORKFLOWS } from "../src/lib/systemWorkflows";

const BUILT_IN_STORE = new Map(
  SYSTEM_ASSISTANT_WORKFLOWS.map((wf) => [
    wf.id,
    { title: wf.title, skill_md: wf.skill_md },
  ]),
) as Map<string, { title: string; skill_md: string }>;

const choiceItems = [{ kind: "choice" }, { kind: "choice" }];

/** Mirrors the two real computation sites after the fix. */
const streamingHasWorkflow = (msgs: { role: string; content: string | null }[]) =>
  msgs.some(
    (m) => m.role === "user" && (m.content ?? "").includes("[Workflow:"),
  );

const dispatcherHasWorkflow = (
  store: Map<string, unknown> | undefined,
  builtInIds: Set<string>,
) => [...(store?.keys() ?? [])].some((id) => !builtInIds.has(id));

describe("hasWorkflow root cause — built-in-only store must NOT enable the picker", () => {
  it("built-in store has size 10 (precondition: the old gate was always true)", () => {
    expect(BUILT_IN_STORE.size).toBeGreaterThanOrEqual(10);
    expect((BUILT_IN_STORE.size ?? 0) > 0).toBe(true); // old, broken signal
  });

  it("naked turn: no docs, store full of built-ins → NO pause (old code paused)", () => {
    expect(
      shouldEmitAskInputsPause({
        items: choiceItems,
        hasAttachedDocuments: false,
        hasWorkflow: dispatcherHasWorkflow(
          BUILT_IN_STORE,
          new Set(BUILT_IN_STORE.keys()),
        ),
      }),
    ).toBe(false);
  });

  it("user-selected workflow in store (non-built-in id) → pause allowed", () => {
    const store = new Map(BUILT_IN_STORE);
    store.set("user-wf-1", { title: "Meu fluxo", skill_md: "..." });
    expect(
      shouldEmitAskInputsPause({
        items: choiceItems,
        hasAttachedDocuments: false,
        hasWorkflow: dispatcherHasWorkflow(
          store,
          new Set(BUILT_IN_STORE.keys()),
        ),
      }),
    ).toBe(true);
  });

  it("streaming gate: sentinel turns carry no [Workflow: marker → tool filtered", () => {
    const nakedTurn = [
      { role: "system", content: "sys" },
      { role: "user", content: "Teste técnico: SINAL_R11=AZUL" },
    ];
    expect(streamingHasWorkflow(nakedTurn)).toBe(false);
  });

  it("streaming gate: user message with selected workflow marker → tool advertised", () => {
    const wfTurn = [
      { role: "system", content: "sys" },
      { role: "user", content: "[Workflow: Revisão NDA (id: builtin-nda-review)]\n\nrevise" },
    ];
    expect(streamingHasWorkflow(wfTurn)).toBe(true);
  });

  it("assistant text mentioning the marker does not count (user role only)", () => {
    const turns = [
      { role: "user", content: "o que é workflow?" },
      { role: "assistant", content: "[Workflow: foo] é um marcador" },
      { role: "user", content: "SINAL_R12=AZUL" },
    ];
    expect(streamingHasWorkflow(turns)).toBe(false);
  });
});
