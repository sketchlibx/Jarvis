import type { AnchorType, ARObjectInstance, AROffset } from "./types";
import { IDENTITY_OFFSET } from "./types";

/**
 * Owns `ARObjectInstance` records only — never geometry, material, or
 * parameters, which stay exclusively in `DesignGraph` (Phase 4). This is
 * the concrete implementation of spec section 11's "do not duplicate the
 * virtual object's geometry" — an instance is just
 * `{ designObjectId, anchor, offset, visibility, interactionMode }`.
 */
export class ARInstanceManager {
  private instances = new Map<string, ARObjectInstance>();

  create(id: string, designObjectId: string, anchorType: AnchorType | null, anchorId: string | null): ARObjectInstance {
    const instance: ARObjectInstance = {
      id, designObjectId, anchorType, anchorId,
      offset: { ...IDENTITY_OFFSET, position: { ...IDENTITY_OFFSET.position }, rotation: { ...IDENTITY_OFFSET.rotation } },
      visible: true,
      interactionMode: "IDLE",
    };
    this.instances.set(id, instance);
    return instance;
  }

  get(id: string): ARObjectInstance | undefined {
    return this.instances.get(id);
  }

  all(): ARObjectInstance[] {
    return [...this.instances.values()];
  }

  has(id: string): boolean {
    return this.instances.has(id);
  }

  remove(id: string): boolean {
    return this.instances.delete(id);
  }

  setAnchor(id: string, anchorType: AnchorType | null, anchorId: string | null): boolean {
    const instance = this.instances.get(id);
    if (!instance) return false;
    instance.anchorType = anchorType;
    instance.anchorId = anchorId;
    return true;
  }

  setOffset(id: string, patch: Partial<AROffset>): boolean {
    const instance = this.instances.get(id);
    if (!instance) return false;
    instance.offset = {
      position: { ...instance.offset.position, ...patch.position },
      rotation: patch.rotation ?? instance.offset.rotation,
      scaleMultiplier: patch.scaleMultiplier ?? instance.offset.scaleMultiplier,
    };
    return true;
  }

  setVisible(id: string, visible: boolean): boolean {
    const instance = this.instances.get(id);
    if (!instance) return false;
    instance.visible = visible;
    return true;
  }

  setInteractionMode(id: string, mode: ARObjectInstance["interactionMode"]): boolean {
    const instance = this.instances.get(id);
    if (!instance) return false;
    instance.interactionMode = mode;
    return true;
  }

  /** Hand-to-hand transfer — spec section 29. Purely a virtual anchor
   * reassignment; nothing about the underlying design changes, and
   * nothing leaves the local process (no network call exists here or
   * anywhere else in this file). */
  transferAnchor(id: string, newAnchorType: AnchorType, newAnchorId: string): boolean {
    return this.setAnchor(id, newAnchorType, newAnchorId);
  }

  /** Instances currently attached to a given anchor id — used by the
   * two-hand-proximity transfer trigger (spec section 29's "user brings
   * RIGHT_HAND near it, pinch with right hand -> transfer"). */
  instancesOnAnchor(anchorId: string): ARObjectInstance[] {
    return this.all().filter((i) => i.anchorId === anchorId);
  }

  clear(): void {
    this.instances.clear();
  }
}
