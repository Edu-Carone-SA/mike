const SECRET_CONTEXT_PATTERNS = [
  /(Incorrect API key provided:\s*)([^.\s]+)(\.?)/gi,
  /(api[_ -]?key|x-api-key|token|secret|authorization|bearer)\s*(?:provided\s*)?(?:is|:|=)\s*["']?([A-Za-z0-9._\-]{6,})["']?/gi,
];

const PROVIDER_KEY_PATTERNS = [
  /\bsk-[A-Za-z0-9_\-]{12,}\b/g,
  /\bsk-ant-[A-Za-z0-9_\-]{12,}\b/g,
  /\bsk-or-[A-Za-z0-9_\-]{12,}\b/g,
  /\bAIza[A-Za-z0-9_\-]{20,}\b/g,
];

export function redactSensitiveText(value: string): string {
  let redacted = value;
  for (const pattern of SECRET_CONTEXT_PATTERNS) {
    redacted = redacted.replace(pattern, (match, ...groups: string[]) => {
      if (match.toLowerCase().startsWith("incorrect api key provided:")) {
        return `${groups[0]}[redacted]${groups[2] ?? ""}`;
      }
      const secret = groups[1];
      return secret ? match.replace(secret, "[redacted]") : match;
    });
  }
  for (const pattern of PROVIDER_KEY_PATTERNS) {
    redacted = redacted.replace(pattern, "[redacted]");
  }
  return redacted;
}

/**
 * Map upstream LLM/provider errors to stable, user-facing product messages.
 * The raw error (full provider JSON) stays in server logs; the chat UI gets
 * a readable, actionable message instead of a JSON blob (QA COR-03).
 */
export function userFacingLlmError(error: unknown, fallback: string): string {
  const raw =
    error instanceof Error && error.message
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (!raw) return fallback;

  const contextMatch = raw.match(/maximum context length/i);
  if (contextMatch) {
    return "Os documentos anexados excedem o limite do modelo. Reduza o número de anexos ou peça uma análise mais específica.";
  }

  const statusMatch = raw.match(/\((\d{3})\)/);
  const status = statusMatch ? Number(statusMatch[1]) : null;
  if (status === 429) {
    return "O modelo está temporariamente sobrecarregado. Tente novamente em alguns instantes — já tentamos automaticamente algumas vezes.";
  }
  if (status === 401 || status === 403) {
    return "Problema de autenticação com o provedor do modelo. Verifique sua chave de API nas configurações.";
  }
  if (status === 402) {
    return "Créditos insuficientes na conta do provedor do modelo.";
  }
  if (status !== null && status >= 500) {
    return "O provedor do modelo está com instabilidade no momento. Tente novamente em instantes.";
  }

  return redactSensitiveText(raw);
}

export function safeErrorMessage(
  error: unknown,
  fallback = "Unexpected error",
): string {
  const message =
    error instanceof Error && error.message
      ? error.message
      : typeof error === "string"
        ? error
        : fallback;
  return redactSensitiveText(message);
}

export function safeErrorLog(error: unknown): {
  name: string | null;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name || null,
      message: redactSensitiveText(error.message || "Unexpected error"),
      stack: error.stack ? redactSensitiveText(error.stack) : undefined,
    };
  }
  return {
    name: null,
    message: safeErrorMessage(error),
  };
}
