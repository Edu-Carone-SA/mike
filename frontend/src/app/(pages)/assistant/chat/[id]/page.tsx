"use client";

import { useEffect, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAssistantChat } from "@/app/hooks/useAssistantChat";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import { ChatView } from "@/app/components/assistant/ChatView";
import { getChat } from "@/app/lib/mikeApi";
import type { Message } from "@/app/components/shared/types";

export default function AssistantChatPage() {
    const router = useRouter();
    const params = useParams();
    const id = params.id as string;

    const { setCurrentChatId, newChatMessages, setNewChatMessages } =
        useChatHistoryContext();

    // [FORM-05] The first message of a brand-new standalone chat must
    // survive any navigation remount. handleNewChat persists it in
    // sessionStorage keyed by chatId (same contract as the TAB-07 project
    // wizard handoff); read it on mount and fall back to the live context
    // value (same-document navigation).
    const pendingFromStorage = useMemo(() => {
        if (typeof window === "undefined") return null;
        try {
            const raw = sessionStorage.getItem("mike:pending-assistant-chat");
            if (!raw) return null;
            const parsed = JSON.parse(raw) as {
                chatId: string;
                message: Message;
            };
            if (parsed.chatId !== id) return null;
            return parsed.message;
        } catch {
            return null;
        }
    }, [id]);

    const initialMessages =
        newChatMessages && newChatMessages.length === 1
            ? newChatMessages
            : pendingFromStorage
              ? [pendingFromStorage]
              : [];
    const {
        messages,
        isResponseLoading,
        handleChat,
        setMessages,
        cancel,
        resumeJob,
    } = useAssistantChat({ initialMessages, chatId: id });

    const hasAutoSent = useRef(false);
    const hasLoaded = useRef(false);

    useEffect(() => {
        setCurrentChatId(id);
    }, [id, setCurrentChatId]);

    useEffect(() => {
        if (initialMessages.length > 0) {
            if (newChatMessages) setNewChatMessages(null);
            return;
        }
        // A pending handoff in storage means the first send is about to
        // happen — do not treat the (still empty) chat as orphaned and
        // bounce back to /assistant before it lands (FORM-05).
        if (pendingFromStorage) return;
        if (hasLoaded.current || messages.length > 0) return;
        hasLoaded.current = true;

        getChat(id)
            .then(({ messages: loaded }) => {
                if (loaded.length > 0) {
                    setMessages(loaded);
                } else {
                    router.replace("/assistant");
                }
            })
            .catch(() => router.replace("/assistant"));
    }, [id]);

    useEffect(() => {
        if (
            !hasAutoSent.current &&
            !isResponseLoading &&
            messages.length === 1 &&
            messages[0].role === "user" &&
            !messages[0].events?.length
        ) {
            const pending =
                newChatMessages?.length === 1 &&
                newChatMessages[0].role === "user"
                    ? newChatMessages[0]
                    : pendingFromStorage;
            if (pending) {
                hasAutoSent.current = true;
                // Consume the storage entry exactly once.
                if (pendingFromStorage) {
                    try {
                        sessionStorage.removeItem(
                            "mike:pending-assistant-chat",
                        );
                    } catch {
                        // ignore
                    }
                }
                void handleChat(pending);
            }
        }
    }, [newChatMessages, pendingFromStorage, messages, isResponseLoading]);

    return (
        <ChatView
            chatId={id}
            messages={messages}
            isResponseLoading={isResponseLoading}
            handleChat={handleChat}
            cancel={cancel}
            resumeJob={resumeJob}
        />
    );
}
