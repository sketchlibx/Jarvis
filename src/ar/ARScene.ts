import * as THREE from "three";
import type { Anchor, ARObjectInstance } from "./types";
import type { DesignGraph } from "../design3d/scene/DesignGraph";
import { GraphRenderer, type GraphRendererHost } from "../design3d/engine/GraphRenderer";

/**
 * # Status: UNVERIFIED (no browser/WebGL context available in this sandbox).
 *
 * Spec section 6's architecture: real camera `<video>` stays visible
 * underneath; this class only owns a TRANSPARENT `WebGLRenderer` layered
 * on top via CSS. It does not create a second camera pipeline or a second
 * MediaPipe pipeline — `ARScene.update()` is fed already-computed
 * `Anchor[]` from `ARAnchorManager`, which itself is fed already-normalized
 * perception data from the EXISTING Phase 3 `VisionPipeline`. This class's
 * only job is turning anchors + AR instances into positioned Three.js objects.
 *
 * Reuses Phase 4's `GraphRenderer` (via the `GraphRendererHost` interface
 * — see that file) to build the actual meshes from `DesignGraph`, rather
 * than re-implementing geometry/material construction — spec section 1's
 * "do not duplicate 3D scene systems."
 */
export class ARScene implements GraphRendererHost {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer | null = null;
  private graphRenderer: GraphRenderer;
  private container: HTMLElement | null = null;
  private animationHandle: number | null = null;
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;

  // AR object root nodes, one per ARObjectInstance — separate from
  // GraphRenderer's own per-DesignObject meshes so an instance's AR
  // transform (anchor + offset) can wrap a design object's mesh without
  // mutating the design object's own DesignGraph transform (spec section
  // 11: "the AR layer controls world transform... DesignGraph remains the
  // source of truth for the design itself" — DesignGraph's own transform
  // values are never touched by AR placement, only this wrapper Group is).
  private instanceGroups = new Map<string, THREE.Group>();

  constructor(designGraph: DesignGraph, verticalFovDegrees = 50) {
    this.scene = new THREE.Scene();
    // No background color set — this scene must render transparent so the
    // real camera video shows through underneath (mount() sets alpha:true).
    this.camera = new THREE.PerspectiveCamera(verticalFovDegrees, 1, 0.01, 100);
    this.camera.position.set(0, 0, 0); // AR "eye" origin; anchors are already camera-relative via CoordinateMapper

    const ambient = new THREE.AmbientLight(0xffffff, 0.9); // flatter than the Design Studio's mood lighting — AR objects need to read clearly against real video
    const key = new THREE.DirectionalLight(0xffffff, 0.6);
    key.position.set(0.5, 1, 0.5);
    this.scene.add(ambient, key);

    // GraphRenderer only needs `.scene` — `this` (ARScene) satisfies
    // GraphRendererHost directly, no adapter object or unsafe cast needed.
    this.graphRenderer = new GraphRenderer(this);
    this.graphRenderer.syncFromGraph(designGraph);
  }

  /** Re-syncs meshes when the underlying design changes (rare compared to
   * per-frame anchor updates — see `update()`'s doc comment). */
  syncDesign(designGraph: DesignGraph): void {
    this.graphRenderer.syncFromGraph(designGraph);
  }

  mount(container: HTMLElement): void {
    if (this.renderer) throw new Error("ARScene already mounted — call dispose() first.");
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); // alpha:true is the whole point — see class doc comment
    this.renderer.setClearColor(0x000000, 0); // fully transparent clear
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.resize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.resizeObserver = new ResizeObserver(() => {
      if (this.container) this.resize(this.container.clientWidth, this.container.clientHeight);
    });
    this.resizeObserver.observe(container);

    this.startRenderLoop();
  }

  private resize(width: number, height: number): void {
    if (!this.renderer || width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private startRenderLoop(): void {
    if (this.animationHandle !== null) return; // duplicate-loop guard, same pattern as VisionPipeline/SceneManager
    const tick = () => {
      if (this.disposed) return;
      if (this.renderer) this.renderer.render(this.scene, this.camera);
      this.animationHandle = requestAnimationFrame(tick);
    };
    this.animationHandle = requestAnimationFrame(tick);
  }

  /**
   * Syncs Three.js TRANSFORMS from current AR instances + anchors. Called
   * once per processed vision frame — per spec section 37, this updates
   * transforms on existing objects; it does NOT rebuild geometry every
   * frame (that only happens via `syncDesign()` when the underlying
   * design actually changes, a much rarer event than a tracking frame).
   */
  update(instances: ARObjectInstance[], anchors: Map<string, Anchor>): void {
    const currentIds = new Set(instances.map((i) => i.id));

    for (const [id, group] of this.instanceGroups) {
      if (!currentIds.has(id)) {
        group.parent?.remove(group);
        this.instanceGroups.delete(id);
      }
    }

    for (const instance of instances) {
      let group = this.instanceGroups.get(instance.id);
      if (!group) {
        group = new THREE.Group();
        this.scene.add(group);
        this.instanceGroups.set(instance.id, group);
      }

      group.visible = instance.visible;
      if (!instance.visible) continue;

      const designMesh = this.graphRenderer.getObject3D(instance.designObjectId);
      if (designMesh && designMesh.parent !== group) {
        group.add(designMesh);
      }

      if (!instance.anchorId) continue; // unanchored instance — position is whatever it was left at, nothing to update from anchors

      const anchor = anchors.get(instance.anchorId);
      if (anchor && anchor.visible) {
        group.visible = true;
        group.position.set(
          anchor.position.x + instance.offset.position.x,
          anchor.position.y + instance.offset.position.y,
          anchor.position.z + instance.offset.position.z
        );
        group.quaternion.set(anchor.rotation.x, anchor.rotation.y, anchor.rotation.z, anchor.rotation.w);
        const s = anchor.scale * instance.offset.scaleMultiplier;
        group.scale.set(s, s, s);
      }
      // else: anchor exists but its tracking is currently LOST/invisible —
      // deliberately DON'T touch group.position/rotation/scale this frame.
      // Leaving them untouched IS "keep last valid transform" (spec
      // section 14) — there's no separate freeze/fade state to manage
      // here because simply not writing new values already produces it.
    }
  }

  /** Full teardown — stops the render loop, disconnects the resize
   * observer, releases the transparent WebGL context, removes the canvas,
   * and disposes every mesh GraphRenderer built for this scene. Per spec
   * section 38: "starting AR again must not create duplicate pipelines" —
   * this is the counterpart to mount(). */
  dispose(): void {
    this.disposed = true;
    if (this.animationHandle !== null) {
      cancelAnimationFrame(this.animationHandle);
      this.animationHandle = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    for (const group of this.instanceGroups.values()) {
      group.parent?.remove(group);
    }
    this.instanceGroups.clear();
    this.graphRenderer.dispose();

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
      this.renderer = null;
    }
    this.container = null;
  }
}
