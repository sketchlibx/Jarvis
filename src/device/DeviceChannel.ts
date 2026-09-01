// ---------------------------------------------------------------------
// Device-to-device transfer — spec section 20.
// STATUS: INTERFACE-ONLY. No network channel, pairing, or transfer
// actually exists. Explicitly, per spec: "Do NOT implement insecure
// arbitrary remote execution." Every transfer kind below is DATA (a
// design file, serialized project, virtual object placement state) —
// never a command, script, or executable payload.
// ---------------------------------------------------------------------

export type TransferKind = "design_file" | "virtual_object" | "project_state" | "approved_task";

export interface DeviceIdentity {
  deviceId: string;
  deviceName: string;
}

export interface TransferRequest {
  kind: TransferKind;
  /** Opaque, kind-specific data — e.g. a serialized DesignSpecification
   * (Phase 4) for design_file/project_state. Typed as unknown rather than
   * a full payload union, since designing the wire format now would be
   * premature for a channel that doesn't exist yet. */
  payload: unknown;
  fromDevice: DeviceIdentity;
  toDevice: DeviceIdentity;
}

export interface TransferAuthorization {
  /** Never auto-approved — this field exists so a future implementation
   * cannot accidentally default it to true; it must be derived from an
   * explicit user action. */
  approvedByUser: boolean;
  approvedAt: string | null;
}

export interface DeviceChannel {
  isConnected(deviceId: string): boolean;
  listPairedDevices(): DeviceIdentity[];
  requestPairing(device: DeviceIdentity): Promise<boolean>;
  sendTransfer(request: TransferRequest, authorization: TransferAuthorization): Promise<void>;
}

/** The only implementation in this codebase. Every method throws or
 * returns an empty/false result — no channel exists, and this class does
 * not pretend otherwise. */
export class UnimplementedDeviceChannel implements DeviceChannel {
  isConnected(_deviceId: string): boolean { return false; }
  listPairedDevices(): DeviceIdentity[] { return []; }
  async requestPairing(_device: DeviceIdentity): Promise<boolean> { return false; }
  async sendTransfer(_request: TransferRequest, _authorization: TransferAuthorization): Promise<void> {
    throw new Error("Device-to-device transfer is not implemented — this is an interface-only foundation (spec section 20).");
  }
}
