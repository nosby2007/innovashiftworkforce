import { Injectable } from '@angular/core';
import { FunctionsClient } from '../functions/functions.client';

export interface AiChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export type AiProposalKind = 'create_shift' | 'assign_shift' | 'publish_shift' | 'unassign_shift';

export interface AiProposal {
  id: string;
  kind: AiProposalKind;
  summary: string;
  payload: Record<string, any>;
}

export interface AiChatResponse {
  ok: boolean;
  reply: string;
  proposals: AiProposal[];
}

@Injectable({ providedIn: 'root' })
export class AiAssistantCommands {
  constructor(private fn: FunctionsClient) {}

  chat(message: string, history: AiChatTurn[]): Promise<AiChatResponse> {
    return this.fn.call('aiAssistantChat', { message, history });
  }
}
