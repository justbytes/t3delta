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

export interface HermesToolCall {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: HermesToolStatus;
  readonly createdAt: string;
  readonly completedAt?: string | undefined;
}

export interface HermesSession {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly conversationId?: string | undefined;
  readonly responseId?: string | undefined;
  readonly messages: HermesChatMessage[];
  readonly toolCalls: HermesToolCall[];
  readonly draft: string;
  readonly isRunning: boolean;
  readonly activeAssistantMessageId?: string | undefined;
  readonly activeStartedAt?: string | undefined;
  readonly error?: string | undefined;
}

export interface HermesChatState {
  readonly sessionIds: string[];
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
