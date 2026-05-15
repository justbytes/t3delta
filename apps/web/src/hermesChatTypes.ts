export type HermesGatewayStatus = "reachable" | "unreachable" | "unknown";

export type HermesMessageRole = "user" | "assistant" | "system";

export interface HermesChatMessage {
  readonly id: string;
  readonly role: HermesMessageRole;
  readonly text: string;
  readonly createdAt: string;
  readonly completedAt?: string | undefined;
  readonly streaming?: boolean;
  readonly interrupted?: boolean;
  readonly error?: string | undefined;
}

export type HermesToolStatus = "running" | "completed" | "failed";

export interface HermesContextUsage {
  readonly usedTokens: number;
  readonly maxTokens: number | null;
}

export interface HermesToolCall {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: HermesToolStatus;
  readonly createdAt: string;
  readonly completedAt?: string | undefined;
  readonly command?: string | undefined;
  readonly output?: string | undefined;
  readonly error?: string | undefined;
  readonly exitCode?: number | undefined;
  readonly filePaths: readonly string[];
  readonly details?: string | undefined;
}

export interface HermesApprovalPrompt {
  readonly id: string;
  readonly action: string;
  readonly detail?: string | undefined;
  readonly status: "pending" | "approved" | "denied";
  readonly createdAt: string;
}

export interface HermesStructuredInputQuestion {
  readonly id: string;
  readonly label: string;
  readonly options: readonly string[];
  readonly allowFreeText: boolean;
}

export interface HermesStructuredInputRequest {
  readonly id: string;
  readonly title: string;
  readonly questions: readonly HermesStructuredInputQuestion[];
  readonly status: "pending" | "submitted";
  readonly createdAt: string;
}

export interface HermesSession {
  readonly id: string;
  readonly title: string;
  readonly titleManuallyEdited?: boolean | undefined;
  readonly archivedAt?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly conversationId?: string | undefined;
  readonly responseId?: string | undefined;
  readonly messages: HermesChatMessage[];
  readonly toolCalls: HermesToolCall[];
  readonly approvals: readonly HermesApprovalPrompt[];
  readonly structuredInputs: readonly HermesStructuredInputRequest[];
  readonly contextUsage?: HermesContextUsage | undefined;
  readonly selectedModel?: string | undefined;
  readonly draft: string;
  readonly isRunning: boolean;
  readonly activeAssistantMessageId?: string | undefined;
  readonly activeStartedAt?: string | undefined;
  readonly error?: string | undefined;
}

export interface HermesChatState {
  readonly sessionIds: string[];
  readonly deletedSessionIds: string[];
  readonly sessionsById: Record<string, HermesSession>;
  readonly activeSessionId: string;
  readonly gatewayStatus: HermesGatewayStatus;
  readonly websocketStatus: "connecting" | "connected" | "disconnected";
  readonly requestInFlight: boolean;
}

export interface HermesWsEnvelope {
  readonly type?: unknown;
  readonly event?: unknown;
  readonly data?: unknown;
  readonly error?: unknown;
  readonly status?: unknown;
}
