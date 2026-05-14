import { create } from "zustand";
import {
  createEmptyHermesSession,
  loadPersistedHermesChatState,
  markRequestInFlight,
  persistHermesChatState,
  reduceHermesWsMessage,
  restoreDraftAfterError,
  resolveApprovalPrompt,
  setDraft,
  stopActiveResponse,
  submitStructuredInput,
  submitUserMessage,
} from "./hermesChatState";
import type { HermesChatState, HermesSession, HermesWsEnvelope } from "./hermesChatTypes";

interface HermesChatStore extends HermesChatState {
  readonly createSession: () => string;
  readonly selectSession: (sessionId: string) => void;
  readonly setDraft: (sessionId: string, draft: string) => void;
  readonly submitUserMessage: (text: string) => void;
  readonly setRequestInFlight: (inFlight: boolean) => void;
  readonly restoreDraftAfterError: (text: string, error: string) => void;
  readonly resolveApprovalPrompt: (approvalId: string, decision: "approved" | "denied") => void;
  readonly submitStructuredInput: (requestId: string) => void;
  readonly stopActiveResponse: () => void;
  readonly applyWsMessage: (message: HermesWsEnvelope) => void;
  readonly setWebsocketStatus: (status: HermesChatState["websocketStatus"]) => void;
  readonly setGatewayStatus: (status: HermesChatState["gatewayStatus"]) => void;
  readonly syncRelaySessions: (sessions: readonly RelaySessionSummary[]) => void;
}

export interface RelaySessionSummary {
  readonly id: string;
  readonly title?: string;
  readonly lastActivity?: string;
}

function persistAndReturn(state: HermesChatState): HermesChatState {
  persistHermesChatState(state);
  return state;
}

export const useHermesChatStore = create<HermesChatStore>((set) => ({
  ...loadPersistedHermesChatState(),
  createSession: () => {
    const session = createEmptyHermesSession(`local-${Date.now()}`);
    set((state) => {
      const next = {
        ...state,
        sessionIds: [session.id, ...state.sessionIds],
        sessionsById: { ...state.sessionsById, [session.id]: session },
        activeSessionId: session.id,
      };
      return persistAndReturn(next);
    });
    return session.id;
  },
  selectSession: (sessionId) =>
    set((state) => {
      if (!state.sessionsById[sessionId] || state.activeSessionId === sessionId) return state;
      return persistAndReturn({ ...state, activeSessionId: sessionId });
    }),
  setDraft: (sessionId, draft) =>
    set((state) => persistAndReturn(setDraft(state, sessionId, draft))),
  submitUserMessage: (text) => set((state) => persistAndReturn(submitUserMessage(state, text))),
  setRequestInFlight: (inFlight) => set((state) => markRequestInFlight(state, inFlight)),
  restoreDraftAfterError: (text, error) =>
    set((state) => persistAndReturn(restoreDraftAfterError(state, text, error))),
  resolveApprovalPrompt: (approvalId, decision) =>
    set((state) => persistAndReturn(resolveApprovalPrompt(state, approvalId, decision))),
  submitStructuredInput: (requestId) =>
    set((state) => persistAndReturn(submitStructuredInput(state, requestId))),
  stopActiveResponse: () => set((state) => persistAndReturn(stopActiveResponse(state))),
  applyWsMessage: (message) =>
    set((state) => persistAndReturn(reduceHermesWsMessage(state, message))),
  setWebsocketStatus: (status) => set((state) => ({ ...state, websocketStatus: status })),
  setGatewayStatus: (status) => set((state) => ({ ...state, gatewayStatus: status })),
  syncRelaySessions: (relaySessions) =>
    set((state) => {
      if (relaySessions.length === 0) return state;
      const nextSessionsById: Record<string, HermesSession> = { ...state.sessionsById };
      const relayIds: string[] = [];
      for (const relaySession of relaySessions) {
        const updatedAt = relaySession.lastActivity ?? new Date().toISOString();
        const existing = nextSessionsById[relaySession.id];
        relayIds.push(relaySession.id);
        nextSessionsById[relaySession.id] = existing
          ? {
              ...existing,
              title: relaySession.title || existing.title,
              updatedAt,
            }
          : {
              ...createEmptyHermesSession(relaySession.id, updatedAt),
              title: relaySession.title || "Hermes session",
              updatedAt,
            };
      }
      const mergedIds = [...relayIds, ...state.sessionIds.filter((id) => !relayIds.includes(id))];
      const activeSessionId = nextSessionsById[state.activeSessionId]
        ? state.activeSessionId
        : mergedIds[0]!;
      return persistAndReturn({
        ...state,
        sessionIds: mergedIds,
        sessionsById: nextSessionsById,
        activeSessionId,
      });
    }),
}));
