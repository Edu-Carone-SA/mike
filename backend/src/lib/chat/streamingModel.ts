import { resolveModel, DEFAULT_MAIN_MODEL } from "../llm";

/**
 * MIKE-07: resolve which chat model actually runs.
 *
 * The admin-configured platform list is the ONLY source of truth when set:
 * a requested model outside the list — including built-in catalog ids —
 * falls back to the first admin model. Only an empty admin list falls back
 * to the built-in catalog (resolveModel).
 *
 * Extracted from streaming.ts (the chat path calls this function) so the
 * contract is unit-testable against the real decision logic.
 */
export function resolveChatModel(
    model: string | null | undefined,
    allowedPlatformModels: string[],
): string {
    if (allowedPlatformModels.length > 0) {
        return model && allowedPlatformModels.includes(model)
            ? model
            : allowedPlatformModels[0];
    }
    return resolveModel(model, DEFAULT_MAIN_MODEL);
}
