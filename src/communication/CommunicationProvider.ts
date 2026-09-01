// ---------------------------------------------------------------------
// Communication / calling architecture — spec section 15.
// STATUS: INTERFACE-ONLY. No platform (Discord, Teams, phone, WhatsApp,
// etc.) is actually connected. This file exists so a future integration
// has a stable shape to implement against, not because any calling
// feature works today. Do not present any of this as functional in the UI.
// ---------------------------------------------------------------------

export interface IncomingCallEvent {
  platform: string;
  callerName: string | null;
  callerId: string;
  receivedAt: string;
}

export interface CommunicationCapabilities {
  canAnswer: boolean;
  canReject: boolean;
  canSendMessage: boolean;
  canPlaceOutgoingCall: boolean;
}

export interface CommunicationProvider {
  readonly platformName: string;
  isConnected(): boolean;
  getCapabilities(): CommunicationCapabilities;
  onIncomingCall(cb: (event: IncomingCallEvent) => void): () => void;
  answer(callId: string): Promise<void>;
  reject(callId: string): Promise<void>;
  sendMessage(recipientId: string, text: string): Promise<void>;
  placeOutgoingCall(recipientId: string): Promise<void>;
}

/** The only implementation that exists in this codebase — every method
 * either returns a "not connected" state or throws, honestly, rather than
 * simulating a working integration. */
export class UnimplementedCommunicationProvider implements CommunicationProvider {
  constructor(public readonly platformName: string) {}
  isConnected(): boolean { return false; }
  getCapabilities(): CommunicationCapabilities {
    return { canAnswer: false, canReject: false, canSendMessage: false, canPlaceOutgoingCall: false };
  }
  onIncomingCall(_cb: (event: IncomingCallEvent) => void): () => void { return () => {}; }
  async answer(_callId: string): Promise<void> { throw new Error(`${this.platformName} is not connected — communication integrations are interface-only in this build.`); }
  async reject(_callId: string): Promise<void> { throw new Error(`${this.platformName} is not connected.`); }
  async sendMessage(_recipientId: string, _text: string): Promise<void> { throw new Error(`${this.platformName} is not connected.`); }
  async placeOutgoingCall(_recipientId: string): Promise<void> { throw new Error(`${this.platformName} is not connected.`); }
}
