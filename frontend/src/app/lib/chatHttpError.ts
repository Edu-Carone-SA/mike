/**
 * P0 QA 15/09/2026 (#96 reaceite): a 429 on POST /chat used to surface as
 * `HTTP 429: {"detail":"Too many chat requests..."}` with no Retry-After,
 * request_id or scope — and could be mistaken for a pause. Parse the
 * typed body (and headers) into a user-facing PT-BR message that is
 * NEVER "Análise pausada" / "Completed".
 */
type RateLimitBody = {
    detail?: unknown;
    scope?: unknown;
    limit?: unknown;
    retryAfterSeconds?: unknown;
    request_id?: unknown;
};

export function formatChatHttpError(
    status: number,
    bodyText: string,
    headers?: { get(name: string): string | null },
): string {
    let parsed: RateLimitBody | null = null;
    try {
        const raw: unknown = JSON.parse(bodyText);
        if (raw && typeof raw === "object") parsed = raw as RateLimitBody;
    } catch {
        parsed = null;
    }

    if (status === 429) {
        const retryAfter =
            (typeof parsed?.retryAfterSeconds === "number"
                ? parsed.retryAfterSeconds
                : undefined) ??
            Number.parseInt(headers?.get("Retry-After") ?? "", 10);
        const requestId =
            (typeof parsed?.request_id === "string" ? parsed.request_id : undefined) ??
            headers?.get("X-Request-Id") ??
            undefined;
        const scope =
            (typeof parsed?.scope === "string" ? parsed.scope : undefined) ??
            headers?.get("X-RateLimit-Scope") ??
            "chat";
        const limit = typeof parsed?.limit === "number" ? parsed.limit : undefined;
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
        const parts = [
            "Limite de solicitações de chat atingido.",
            wait ? `Tente de novo em cerca de ${wait} segundos.` : "Tente de novo em alguns minutos.",
        ];
        if (scope) parts.push(`Escopo: ${scope}.`);
        if (limit) parts.push(`Limite: ${limit}.`);
        if (requestId) parts.push(`request_id: ${requestId}.`);
        return parts.join(" ");
    }

    if (parsed && typeof parsed.detail === "string" && parsed.detail.trim()) {
        return parsed.detail.trim();
    }
    const trimmed = bodyText.trim();
    return trimmed ? `HTTP ${status}: ${trimmed}` : `HTTP ${status}`;
}
