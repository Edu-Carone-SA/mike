import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import {
    buildProjectDocContext,
    buildMessages,
    buildWorkflowStore,
    enrichWithPriorEvents,
    appendAskInputsResponseToLastAssistantMessage,
    appendAssistantEventsToLastAssistantMessage,
    AssistantStreamError,
    buildCancelledAssistantMessage,
    extractCitations,
    isAbortError,
    runLLMStream,
    stripTransientAssistantEvents,
    PROJECT_EXTRA_TOOLS,
    parseAskInputsResponsePayload,
    type ChatMessage,
} from "../lib/chat";
import {
    getUserModelSettings,
} from "../lib/userSettings";
import { checkProjectAccess } from "../lib/access";
import {
    buildTurnPlan,
    finalizeJobAfterStream,
    safeFailJob,
    startOrResumeJob,
    JobAbortSignal,
} from "../lib/chat/chatJobRunner";
import { saveCheckpoint, transitionAnalysisJob } from "../lib/analysisJobs";
import { safeErrorLog, safeErrorMessage, userFacingLlmError } from "../lib/safeError";

const PROJECT_SYSTEM_PROMPT_EXTRA = `PROJECT CONTEXT:
You are operating within a project folder that contains a collection of legal documents the user has organised for a single matter. The user's questions will usually refer to one or more documents in this project — your job is to find the relevant files to work on. Use list_documents to see what is available and fetch_documents / read_document to pull in any documents you need before answering.

A document may currently be displayed in the user's side panel; when provided, treat it as context for the user's likely focus, but do NOT assume it is the only or definitive document the user is asking about. If the request could apply to other files in the project, identify and read those as well. Prefer coverage across the relevant project documents over an over-narrow reading of only the displayed one.

REPLICATING A DOCUMENT:
When the user wants to use an existing project document as a starting point for a new file (e.g. "use this NDA as a template", "make me a copy of the SOW so I can edit it", "duplicate this and adapt it for company X"), call the replicate_document tool with the source doc_id. This creates a byte-for-byte copy as a new project document, returns a fresh doc_id slug, and shows a download/open card in the UI. Then call edit_document on the returned slug to make the user's requested changes — do NOT call generate_docx for cases where the user clearly wants the existing document's structure and formatting preserved.`;

export const projectChatRouter = Router({ mergeParams: true });

// POST /projects/:projectId/chat — streaming
projectChatRouter.post("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { projectId } = req.params;
    const {
        messages,
        chat_id,
        model,
        displayed_doc,
        attached_documents,
        ask_inputs_response,
        resume_job_id,
    } =
        req.body as {
            messages: ChatMessage[];
            chat_id?: string;
            model?: string;
            displayed_doc?: { filename: string; document_id: string };
            attached_documents?: { filename: string; document_id: string }[];
            ask_inputs_response?: unknown;
            resume_job_id?: string;
        };
    const askInputsResponse = parseAskInputsResponsePayload(
        ask_inputs_response,
    );

    const db = createServerSupabase();

    // Verify the user has access to the project (owner or shared member).
    const projectAccess = await checkProjectAccess(
        projectId,
        userId,
        userEmail,
        db,
    );
    if (!projectAccess.ok)
        return void res.status(404).json({ detail: "Project not found" });

    let chatId = chat_id ?? null;
    let chatTitle: string | null = null;

    if (chatId) {
        const { data: existing } = await db
            .from("chats")
            .select("id, title, project_id")
            .eq("id", chatId)
            .single();
        const canUse = !!existing && existing.project_id === projectId;
        if (!canUse) chatId = null;
        else chatTitle = existing!.title;
    }

    if (!chatId) {
        const { data: newChat, error } = await db
            .from("chats")
            .insert({ user_id: userId, project_id: projectId })
            .select("id, title")
            .single();
        if (error || !newChat)
            return void res
                .status(500)
                .json({ detail: "Failed to create chat" });
        chatId = newChat.id as string;
        chatTitle = newChat.title;
    }

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    // Sprint 4 fix: attached_documents (request body) must reach the doc
    // context. buildDocContext resolves doc labels (doc-0, …) from
    // messages[].files — without this merge the attachments were only
    // named in the system prompt, and read_document/edit_document on them
    // returned "Document not found" while the doc sat ready in storage.
    if (lastUser && attached_documents?.length) {
        const existing = Array.isArray(lastUser.files) ? lastUser.files : [];
        const seen = new Set(
            existing
                .map((f) => (f as { document_id?: unknown })?.document_id)
                .filter((id): id is string => typeof id === "string"),
        );
        const attached = attached_documents as {
            filename: string;
            document_id: string;
        }[];
        const merged = [
            ...existing,
            ...attached
                .filter((d) => !seen.has(d.document_id))
                .map((d) => ({ document_id: d.document_id, filename: d.filename })),
        ];
        lastUser.files = merged;
    }
    if (askInputsResponse) {
        await appendAskInputsResponseToLastAssistantMessage(
            db,
            chatId,
            askInputsResponse,
        );
    } else if (lastUser) {
        const { error: insertError } = await db
            .from("chat_messages")
            .insert({
                chat_id: chatId,
                role: "user",
                content: lastUser.content,
                files: lastUser.files ?? null,
            });
        if (insertError) {
            console.error(
                "[projectChat/stream] failed to persist user message",
                safeErrorLog(insertError),
            );
        }
    }

    const { docIndex, docStore, folderPaths } = await buildProjectDocContext(
        projectId,
        userId,
        db,
    );
    const docAvailability = Object.entries(docIndex).map(([doc_id, info]) => ({
        doc_id,
        filename: info.filename,
        folder_path: folderPaths.get(doc_id),
    }));

    const enrichedMessages = await enrichWithPriorEvents(
        messages,
        chatId,
        db,
        docIndex,
    );
    const messagesForLLM: ChatMessage[] = displayed_doc
        ? enrichedMessages.map((m, i) => {
              if (i !== enrichedMessages.length - 1 || m.role !== "user")
                  return m;
              return {
                  ...m,
                  content: `${m.content}\n\ndisplayed_doc: ${displayed_doc.filename}, displayed_doc_id: ${displayed_doc.document_id}`,
              };
          })
        : enrichedMessages;

    // The user-attached docs for this turn (dragged into / picked from
    // the chat input) come in as a request-level field. Surface them in
    // the system prompt with the current-turn doc_id slugs so the model
    // knows which docs the user is highlighting *now*, distinct from
    // the broader project doc list.
    let systemPromptExtra = PROJECT_SYSTEM_PROMPT_EXTRA;
    if (attached_documents?.length) {
        const slugByDocumentId = new Map<string, string>();
        for (const [slug, info] of Object.entries(docIndex)) {
            if (info.document_id)
                slugByDocumentId.set(info.document_id, slug);
        }
        const lines = attached_documents.map((d) => {
            const slug = slugByDocumentId.get(d.document_id);
            return slug ? `- ${slug}: ${d.filename}` : `- ${d.filename}`;
        });
        systemPromptExtra += `\n\nUSER-ATTACHED DOCUMENTS FOR THIS TURN:\nThe user has attached the following document(s) directly to their latest message. Treat these as the primary focus of the request unless their message clearly says otherwise.\n${lines.join("\n")}`;
    }

    const {
        api_keys: apiKeys,
        legal_research_us: legalResearchUs,
    } = await getUserModelSettings(userId, db);
    const apiMessages = buildMessages(
        messagesForLLM,
        docAvailability,
        systemPromptExtra,
        undefined,
        legalResearchUs,
    );

    const workflowStore = await buildWorkflowStore(userId, userEmail, db);

    // Sprint 1 orchestration (QA JOB-02): deterministic plan before any
    // tool fires — one section per attached document plus a mandatory
    // final synthesis section.
    const analysisPlan = buildTurnPlan(attached_documents);
    if (attached_documents?.length) {
        const planLines = analysisPlan.sections.map(
            (s) =>
                `${s.index}. ${s.label}${s.document_id ? "" : " (obrigatória ao final)"}`,
        );
        systemPromptExtra =
            (systemPromptExtra ? systemPromptExtra + "\n\n" : "") +
            `PLANO DE ANÁLISE DESTA EXECUÇÃO (siga esta ordem, seção por seção, antes de responder):\n` +
            planLines.join("\n") +
            `\nAo esgotar o orçamento de ferramentas, produza a síntese final com o que já foi lido e declare explicitamente qualquer seção pendente. A seção final de síntese é obrigatória.`;
    }
    const requestedToolBudget = Number(
        (req.body as { tool_budget?: number }).tool_budget,
    );
    const toolBudget =
        Number.isFinite(requestedToolBudget) && requestedToolBudget >= 1
            ? Math.floor(requestedToolBudget)
            : undefined;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const write = (line: string) => res.write(line);
    const streamAbort = new AbortController();
    let streamFinished = false;
    res.on("close", () => {
        if (!streamFinished) streamAbort.abort();
    });

    // SSE keepalive: send a comment every 15s to prevent ALB idle timeout
    // from dropping the connection during long tool executions (e.g., generate_docx)
    const keepalive = setInterval(() => {
        if (!streamFinished) {
            try {
                res.write(": keepalive\n\n");
            } catch {
                // socket already closed
            }
        }
    }, 15000);

    let analysisJobId: string | null = null;
    try {
        write(`data: ${JSON.stringify({ type: "chat_id", chatId })}\n\n`);

        // Sprint 1 orchestration (QA JOB-02): the project chat now runs
        // the same analysis-job lifecycle as the standalone chat — job
        // up front, plan before tools, checkpoints per tool batch, typed
        // pause on tool-budget exhaustion and resume on the same job.
        const resumeJobId =
            typeof resume_job_id === "string" && resume_job_id.trim()
                ? resume_job_id.trim()
                : null;
        const { job, priorBatches } = await startOrResumeJob({
            db,
            userId,
            chatId,
            projectId,
            model: model ?? null,
            kind: "chat_analysis",
            resumeJobId,
            analysisPlan,
            write,
        });
        analysisJobId = job.id;
        const baseBatchIndex = priorBatches;

        const { events, citations, paused } = await runLLMStream({
            apiMessages,
            docStore,
            docIndex,
            userId,
            db,
            write,
            extraTools: PROJECT_EXTRA_TOOLS,
            workflowStore,
            includeResearchTools: legalResearchUs,
            model,
            apiKeys,
            signal: streamAbort.signal,
            projectId,
            job: {
                maxToolIterations: toolBudget,
                onToolBatchEnd: async (info) => {
                    const checkpoint = await saveCheckpoint(db, {
                        jobId: job.id,
                        sectionIndex: baseBatchIndex + info.batchIndex,
                        sectionLabel: info.toolNames.join(", ").slice(0, 200),
                        status: "completed",
                        toolsUsed: info.toolNames,
                    });
                    await transitionAnalysisJob(db, job.id, "running", {
                        checkpointId: checkpoint.id,
                        toolCallsCount: baseBatchIndex + info.batchIndex,
                    });
                    write(
                        `data: ${JSON.stringify({
                            type: "job_status",
                            jobId: job.id,
                            state: "running",
                            progress: {
                                completedSections: info.batchIndex,
                                totalSections: 0,
                                currentLabel: info.toolNames.join(", "),
                            },
                            checkpointId: checkpoint.id,
                        })}\n\n`,
                    );
                },
            },
        });

        // Persist the terminal state in the job entity (never inferred
        // from tool-step wrappers). `paused` is resumable, not a failure.
        await finalizeJobAfterStream({
            db,
            job,
            chatId,
            paused: !!paused,
            write,
        });
        if (paused) {
            return;
        }

        const persistedEvents = stripTransientAssistantEvents(events);
        if (askInputsResponse) {
            await appendAssistantEventsToLastAssistantMessage(
                db,
                chatId,
                persistedEvents,
                citations,
            );
        } else {
            await db.from("chat_messages").insert({
                chat_id: chatId,
                role: "assistant",
                content: persistedEvents.length ? persistedEvents : null,
                citations: citations.length ? citations : null,
            });
        }

        if (!chatTitle && lastUser?.content) {
            await db
                .from("chats")
                .update({ title: lastUser.content.slice(0, 120) })
                .eq("id", chatId);
        }
    } catch (err) {
        if (err instanceof JobAbortSignal) {
            // startOrResumeJob already wrote the typed SSE error + [DONE].
            return;
        }
        if (isAbortError(err)) {
            console.log("[project-chat/stream] client aborted stream", {
                chatId,
            });
            if (analysisJobId) {
                await safeFailJob(
                    db,
                    analysisJobId,
                    "cancelled",
                    "user_cancelled",
                );
            }
            if (err instanceof AssistantStreamError) {
                const partial = buildCancelledAssistantMessage({
                    fullText: err.fullText,
                    events: err.events,
                    buildCitations: (fullText, events) =>
                        extractCitations(fullText, docIndex, events),
                });
                const saveError = askInputsResponse
                    ? null
                    : (
                          await db.from("chat_messages").insert({
                              chat_id: chatId,
                              role: "assistant",
                              content: partial.events.length
                                  ? partial.events
                                  : null,
                              citations: partial.citations.length
                                  ? partial.citations
                                  : null,
                          })
                      ).error;
                if (askInputsResponse) {
                    await appendAssistantEventsToLastAssistantMessage(
                        db,
                        chatId,
                        partial.events,
                        partial.citations,
                    );
                }
                if (saveError) {
                    console.error(
                        "[project-chat/stream] failed to save aborted stream",
                        saveError,
                    );
                }
            }
            return;
        }
        console.error("[project-chat/stream] error:", safeErrorLog(err));
        if (analysisJobId) {
            await safeFailJob(
                db,
                analysisJobId,
                "failed",
                null,
                userFacingLlmError(err, "Stream error"),
            );
        }
        const message = userFacingLlmError(err, "Stream error");
        const errorEvents = err instanceof AssistantStreamError
            ? stripTransientAssistantEvents(err.events)
            : [{ type: "error" as const, message }];
        const errorFullText =
            err instanceof AssistantStreamError ? err.fullText : "";
        try {
            const citations = extractCitations(
                errorFullText,
                docIndex,
                errorEvents,
            );
            const saveError = askInputsResponse
                ? null
                : (
                      await db.from("chat_messages").insert({
                          chat_id: chatId,
                          role: "assistant",
                          content: errorEvents.length ? errorEvents : null,
                          citations: citations.length ? citations : null,
                      })
                  ).error;
            if (askInputsResponse) {
                await appendAssistantEventsToLastAssistantMessage(
                    db,
                    chatId,
                    errorEvents,
                    citations,
                );
            }
            if (saveError)
                console.error("[project-chat/stream] failed to save error", saveError);
        } catch (saveErr) {
            console.error("[project-chat/stream] failed to save error", saveErr);
        }
        try {
            write(
                `data: ${JSON.stringify({ type: "error", message })}\n\n`,
            );
            write("data: [DONE]\n\n");
        } catch {
            /* ignore */
        }
    } finally {
        streamFinished = true;
        clearInterval(keepalive);
        res.end();
    }
});
