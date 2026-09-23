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
 *
 * Visual completion pass (this session): added hand-wrist markers, a face
 * marker, and a selection outline that recolors by real interactionMode
 * (grab/transfer feedback). None of these introduce new tracking — they
 * render anchor positions and instance state this class already receives
 * every frame via update()'s parameters. Pose markers were deliberately
 * NOT added this pass — see PHASE-CONTINUITY.md for why.
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

  // Visual-only additions (this session): render markers at anchor
  // positions ARScene ALREADY receives every frame via update()'s
  // `anchors` map — no new tracking math, no second hand/gesture system.
  // Hidden whenever the corresponding anchor isn't currently visible,
  // per spec section 14's "don't show placement for lost tracking."
  private handMarkers = new Map<"left_hand" | "right_hand", THREE.Mesh>();
  private faceMarker: THREE.Mesh;
  private selectedInstanceId: string | null = null;
  private selectionOutline: THREE.Box3Helper | null = null;

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

    // Hand-wrist markers: small cyan rings, one per hand source. Cyan
    // because this is HUD/tracking chrome, not the JARVIS core itself —
    // see global.css's color-role rule (orange/gold is reserved for the
    // orb alone).
    for (const source of ["left_hand", "right_hand"] as const) {
      const marker = new THREE.Mesh(
        new THREE.TorusGeometry(0.018, 0.0035, 8, 24),
        new THREE.MeshBasicMaterial({ color: 0x4ee1ff, transparent: true, opacity: 0.8 })
      );
      marker.visible = false;
      this.scene.add(marker);
      this.handMarkers.set(source, marker);
    }

    // Face marker: a small crosshair-like ring, only ever shown when a
    // real face anchor is currently visible (see update()) — never drawn
    // speculatively.
    this.faceMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.02, 0.024, 24),
      new THREE.MeshBasicMaterial({ color: 0x4ee1ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    this.faceMarker.visible = false;
    this.scene.add(this.faceMarker);
  }

  /** Called by ARController whenever the Design Studio selection changes
   * (spec section 21: selection is deterministic, driven by Design
   * Studio's own selection state, never gesture-guessed). Drives the
   * selection outline drawn in update(). */
  setSelection(instanceId: string | null): void {
    this.selectedInstanceId = instanceId;
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
    // Bug found during this session's orphaned-CSS sweep: global.css has
    // had a `.ar-view canvas.ar-overlay` rule (pointer-events: none, fills
    // the container) since an earlier session, but nothing ever put that
    // class on the actual canvas element — it was dead CSS masking a real
    // gap: without pointer-events:none, this transparent canvas could
    // intercept clicks meant for whatever's visually behind/around it.
    this.renderer.domElement.classList.add("ar-overlay");

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

    // Hand markers — purely visualizing anchors already computed above;
    // no new landmark math.
    for (const [source, marker] of this.handMarkers) {
      const anchor = anchors.get(`${source}:HAND_WRIST`);
      if (anchor && anchor.visible) {
        marker.visible = true;
        marker.position.set(anchor.position.x, anchor.position.y, anchor.position.z);
        marker.quaternion.set(anchor.rotation.x, anchor.rotation.y, anchor.rotation.z, anchor.rotation.w);
      } else {
        marker.visible = false;
      }
    }

    // Face marker — same principle: only shown when Phase 3's face
    // detector is actually producing a visible anchor this frame.
    const faceAnchor = anchors.get("face:FACE");
    if (faceAnchor && faceAnchor.visible) {
      this.faceMarker.visible = true;
      this.faceMarker.position.set(faceAnchor.position.x, faceAnchor.position.y, faceAnchor.position.z);
      this.faceMarker.quaternion.set(faceAnchor.rotation.x, faceAnchor.rotation.y, faceAnchor.rotation.z, faceAnchor.rotation.w);
    } else {
      this.faceMarker.visible = false;
    }

    // Selection + grab/transfer feedback — colors the SAME outline by the
    // REAL `interactionMode` ARController already tracks per instance
    // (IDLE/HOVER/GRABBING/TWO_HAND_TRANSFORMING), rather than a separate
    // fabricated "is grabbing" flag.
    const selected = this.selectedInstanceId
      ? instances.find((i) => i.id === this.selectedInstanceId)
      : undefined;
    const selectedGroup = this.selectedInstanceId ? this.instanceGroups.get(this.selectedInstanceId) : undefined;
    if (selected && selectedGroup && selectedGroup.visible) {
      if (!this.selectionOutline) {
        this.selectionOutline = new THREE.Box3Helper(new THREE.Box3(), 0x4ee1ff);
        this.scene.add(this.selectionOutline);
      }
      this.selectionOutline.box.setFromObject(selectedGroup);
      const color =
        selected.interactionMode === "GRABBING" ? 0x4ee1a0 :
        selected.interactionMode === "TWO_HAND_TRANSFORMING" ? 0xffb84d :
        0x4ee1ff; // IDLE/HOVER — plain HUD cyan
      (this.selectionOutline.material as THREE.LineBasicMaterial).color.setHex(color);
      this.selectionOutline.visible = true;
    } else if (this.selectionOutline) {
      this.selectionOutline.visible = false;
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

    for (const marker of this.handMarkers.values()) {
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
      marker.parent?.remove(marker);
    }
    this.handMarkers.clear();
    this.faceMarker.geometry.dispose();
    (this.faceMarker.material as THREE.Material).dispose();
    this.faceMarker.parent?.remove(this.faceMarker);
    if (this.selectionOutline) {
      this.selectionOutline.geometry.dispose();
      (this.selectionOutline.material as THREE.Material).dispose();
      this.selectionOutline.parent?.remove(this.selectionOutline);
      this.selectionOutline = null;
    }

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
      this.renderer = null;
    }
    this.container = null;
  }
}
