import * as THREE from "three";
import type { JarvisState } from "../../orchestrator/JarvisStateMachine";

/**
 * # Status: UNVERIFIED (no WebGL context available in this sandbox).
 *
 * Layered energy-core built from additive-blended sprites, a particle
 * shell, a wireframe icosahedron, an armillary-sphere ring set, and
 * (added this session, once real reference screenshots were finally
 * provided) 16 tapered-cone sunburst spikes radiating outward at random
 * angles/lengths — the reference images' single most distinctive feature,
 * previously missing entirely. Orange/gold core, cyan/teal reserved for
 * surrounding HUD chrome (see global.css). Deliberately NOT using
 * EffectComposer/UnrealBloomPass: real bloom post-processing needs an
 * opaque render target, which fights this visualizer's transparent
 * background requirement (it's composited over the Home command-center
 * UI, not over a solid canvas). Additive blending on a transparent clear
 * color gives the same "glowing energy" read without that tradeoff.
 *
 * Public API (mount/dispose/setState/setAudioLevel/resize-on-observe) is
 * UNCHANGED, so JarvisVisualizerView and every caller keep working without
 * modification.
 *
 * Each `JarvisState` still gets genuinely distinct behavior — see
 * `updateAnimation`'s per-case comments. `setAudioLevel` is only ever fed
 * real microphone amplitude by the caller (see JarvisVisualizerView) —
 * this class has no synthesized fallback for it.
 */
export type JarvisAnimationQuality = "low" | "medium" | "high";

export class JarvisVisualizer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer | null = null;

  private coreGroup: THREE.Group;
  private coreWire: THREE.LineSegments;
  private haloSprite: THREE.Sprite;
  private midSprite: THREE.Sprite;
  private hotSprite: THREE.Sprite;
  private shellPoints: THREE.Points;
  private shellMaterial: THREE.PointsMaterial;
  private rings: THREE.Mesh[] = [];
  private spikes: THREE.Mesh[] = [];
  private dust: THREE.Points;

  private animationHandle: number | null = null;
  private disposed = false;
  private state: JarvisState = "IDLE";
  private audioLevel = 0; // 0..1, see setAudioLevel
  private elapsed = 0;
  private resizeObserver: ResizeObserver | null = null;
  private readonly cameraPadding = 1.18;
  private coarsePointer = false;
  private basePixelRatioCap = 1.25;
  private frameAccumulator = 0;
  private frameSamples = 0;
  private lastQualityAdjust = 0;

  // Smoothed color the whole core lerps toward each frame, so state
  // changes read as a deliberate transition rather than an abrupt snap.
  private targetColor = new THREE.Color(0x35d9ff);
  private currentColor = new THREE.Color(0x35d9ff);

  // Slow cinematic color cycle for the normal orb. The hue is deliberately
  // constrained to cool JARVIS tones so the core changes color without
  // turning into a random/rainbow effect. State-specific alert colors below
  // still take priority over this cycle.
  private getAutomaticCoreColor(): THREE.Color {
    const phase = (this.elapsed % 18) / 18;
    const stops = [
      { t: 0.00, c: new THREE.Color(0x27d7ff) },
      { t: 0.24, c: new THREE.Color(0x397bff) },
      { t: 0.48, c: new THREE.Color(0x8b5cff) },
      { t: 0.72, c: new THREE.Color(0x22e0c0) },
      { t: 1.00, c: new THREE.Color(0x27d7ff) },
    ];
    for (let i = 1; i < stops.length; i++) {
      if (phase <= stops[i].t) {
        const a = stops[i - 1];
        const b = stops[i];
        return a.c.clone().lerp(b.c, (phase - a.t) / (b.t - a.t));
      }
    }
    return stops[0].c.clone();
  }

  constructor(private readonly quality: JarvisAnimationQuality = "high") {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    // Framed dynamically in resize(): the sunburst tips can extend far
    // beyond the spherical core, especially on a tall phone viewport.
    this.camera.position.set(0, 0, 8.4);

    this.coreGroup = new THREE.Group();
    this.coreGroup.scale.setScalar(1.08);
    this.scene.add(this.coreGroup);

    // --- soft glow sprites (halo -> mid -> hot core), additive-blended ---
    const glowTex = JarvisVisualizer.makeGlowTexture();
    this.haloSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTex, color: 0xb35a10, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.haloSprite.scale.set(3.4, 3.4, 1);
    this.midSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTex, color: 0xff9d4d, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.midSprite.scale.set(1.7, 1.7, 1);
    this.hotSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTex, color: 0xfff0d8, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.hotSprite.scale.set(0.68, 0.68, 1);
    this.coreGroup.add(this.haloSprite, this.midSprite, this.hotSprite);

    // --- crystalline wireframe core sitting inside the glow: gives the
    // orb a "machine" identity rather than reading as a pure blob of light ---
    const wireGeo = new THREE.IcosahedronGeometry(0.62, 1);
    const edges = new THREE.EdgesGeometry(wireGeo);
    this.coreWire = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.55 })
    );
    this.coreGroup.add(this.coreWire);

    // --- particle shell: a loose cloud of points around the core ---
    const shellCount = qualityPointCount(this.quality, 520, 900, 1200);
    const positions = new Float32Array(shellCount * 3);
    const seeds = new Float32Array(shellCount); // per-particle phase for organic drift
    for (let i = 0; i < shellCount; i++) {
      const radius = THREE.MathUtils.lerp(0.9, 1.9, Math.pow(Math.random(), 1.6));
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
      const i3 = i * 3;
      positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i3 + 2] = radius * Math.cos(phi);
      seeds[i] = Math.random() * Math.PI * 2;
    }
    const shellGeo = new THREE.BufferGeometry();
    shellGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    shellGeo.setAttribute("seed", new THREE.BufferAttribute(seeds, 1));
    this.shellMaterial = new THREE.PointsMaterial({
      color: 0xffb066, size: 0.028, map: glowTex, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this.shellPoints = new THREE.Points(shellGeo, this.shellMaterial);
    this.coreGroup.add(this.shellPoints);

    // --- thin gyroscopic rings, each tilted on a different axis: a denser
    // "armillary sphere" set (was 3, now 5) to match the reference
    // screenshots' layered great-circle look more closely ---
    for (let i = 0; i < 5; i++) {
      const ringGeometry = new THREE.TorusGeometry(1.05 + i * 0.22, 0.006, 8, 96);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0xff9d4d, transparent: true, opacity: 0.26 - i * 0.035,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = Math.PI / 2 + i * 0.42;
      ring.rotation.y = i * 0.31;
      this.rings.push(ring);
      this.coreGroup.add(ring);
    }

    // --- sunburst spikes: the reference screenshots' single most
    // distinctive feature — long thin rays shooting outward from the core
    // at irregular angles/lengths, like a lens flare. Built from tapered
    // cone geometry (naturally comes to a point, no gradient texture
    // needed) rather than plain lines, since WebGL line width/alpha-taper
    // support is inconsistent across browsers/platforms. */
    const spikeCount = 16;
    for (let i = 0; i < spikeCount; i++) {
      const dir = new THREE.Vector3(
        THREE.MathUtils.randFloatSpread(2),
        THREE.MathUtils.randFloatSpread(2),
        THREE.MathUtils.randFloatSpread(2),
      ).normalize();
      const length = THREE.MathUtils.lerp(1.0, 2.4, Math.random());
      const baseRadius = THREE.MathUtils.lerp(0.012, 0.026, Math.random());
      const geo = new THREE.ConeGeometry(baseRadius, length, 5);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffb066, transparent: true, opacity: 0.4,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const spike = new THREE.Mesh(geo, mat);
      spike.position.copy(dir).multiplyScalar(0.5 + length / 2);
      spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      this.spikes.push(spike);
      this.coreGroup.add(spike);
    }

    // --- faint background dust for depth; sparse enough to never compete
    // with the core (spec's "no unnecessary decorative clutter") ---
    const dustCount = qualityPointCount(this.quality, 120, 260, 380);
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      const i3 = i * 3;
      dustPos[i3] = THREE.MathUtils.randFloatSpread(9);
      dustPos[i3 + 1] = THREE.MathUtils.randFloatSpread(9);
      dustPos[i3 + 2] = THREE.MathUtils.randFloatSpread(6) - 2;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    this.dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({ color: 0x2c6fa8, size: 0.016, map: glowTex, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true })
    );
    this.scene.add(this.dust);

    const point = new THREE.PointLight(0xffab5e, 6, 6, 2);
    this.coreGroup.add(point);
  }

  /** Soft radial-gradient sprite texture shared by every glow element and
   * the point clouds — one canvas, reused everywhere via material.map. */
  private static makeGlowTexture(): THREE.CanvasTexture {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.25, "rgba(210,245,255,0.9)");
    gradient.addColorStop(0.55, "rgba(78,225,255,0.35)");
    gradient.addColorStop(1, "rgba(46,124,246,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  setState(state: JarvisState): void {
    this.state = state;
  }

  /**
   * Feeds real audio amplitude (0..1) for LISTENING. NEVER called with a
   * synthesized/fake value when no real microphone is producing audio — per
   * spec section 9's explicit "do not fake actual microphone audio when no
   * microphone exists." When no real source is available, callers should
   * simply not call this method (it defaults to 0, producing a calm/minimal
   * ring animation). SPEAKING intentionally does NOT use this: the Web
   * Speech TTS engine exposes no audio buffer to sample from, so SPEAKING's
   * pulse is driven by elapsed time instead of a fabricated level.
   */
  setAudioLevel(level: number): void {
    this.audioLevel = Math.max(0, Math.min(1, level));
  }

  mount(container: HTMLElement): void {
    if (this.renderer) throw new Error("JarvisVisualizer already mounted — call dispose() first.");
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    // Rendering at native 2x on high-DPI phones can become the dominant
    // frame-time cost. Keep the visual crisp while leaving enough GPU budget
    // for a high-refresh-rate display.
    this.coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const qualityCap = this.quality === "low" ? 1 : this.quality === "medium" ? 1.5 : 1.75;
    this.basePixelRatioCap = Math.min(this.coarsePointer ? 1.25 : 1.75, qualityCap);
    const dpr = Math.min(window.devicePixelRatio || 1, this.basePixelRatioCap);
    this.renderer.setPixelRatio(dpr);
    this.resize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.resizeObserver = new ResizeObserver(() => this.resize(container.clientWidth, container.clientHeight));
    this.resizeObserver.observe(container);

    this.startRenderLoop();
  }

  private resize(width: number, height: number): void {
    if (!this.renderer || width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    // The longest sunburst spike is ~2.4 world units from the core center;
    // account for the group scale, glow margin, and tall/narrow screens so
    // no spike is allowed to clip out of the viewport.
    const coreRadius = 2.9 * this.coreGroup.scale.x * this.cameraPadding;
    const verticalDistance = coreRadius / Math.tan(verticalFov / 2);
    const portraitBoost = this.camera.aspect < 0.9 ? 1.1 : 1;
    this.camera.position.z = Math.max(7.8, verticalDistance * portraitBoost);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private startRenderLoop(): void {
    if (this.animationHandle !== null) return;
    let lastTime = performance.now();
    const tick = (now: number) => {
      if (this.disposed) return;
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      this.elapsed += dt;
      this.updateAnimation(dt);
      if (this.renderer && document.visibilityState !== "hidden") {
        this.renderer.render(this.scene, this.camera);
      }
      this.frameAccumulator += dt * 1000;
      this.frameSamples += 1;
      if (now - this.lastQualityAdjust > 1200 && this.frameSamples >= 24) {
        const avgFrameMs = this.frameAccumulator / this.frameSamples;
        const currentDpr = this.renderer?.getPixelRatio() ?? 1;
        // Target a high-refresh budget (~8.33ms/frame) without promising a
        // hardware-specific FPS. Sustained overload reduces render resolution
        // before animation starts dropping frames; sustained headroom restores
        // it gradually. Only adjust at most once every ~1.2s to avoid thrash.
        if (avgFrameMs > 11 && currentDpr > 1) {
          this.renderer?.setPixelRatio(Math.max(1, currentDpr - 0.15));
        } else if (avgFrameMs < 6.5 && currentDpr < this.basePixelRatioCap) {
          this.renderer?.setPixelRatio(Math.min(this.basePixelRatioCap, currentDpr + 0.1));
        }
        this.frameAccumulator = 0;
        this.frameSamples = 0;
        this.lastQualityAdjust = now;
      }
      this.animationHandle = requestAnimationFrame(tick);
    };
    this.animationHandle = requestAnimationFrame(tick);
  }

  private setGlow(scale: number, hotOpacity: number, midOpacity: number, haloOpacity: number): void {
    this.hotSprite.scale.setScalar(0.68 * scale);
    this.midSprite.scale.setScalar(1.7 * scale);
    this.haloSprite.scale.setScalar(3.4 * scale);
    (this.hotSprite.material as THREE.SpriteMaterial).opacity = hotOpacity;
    (this.midSprite.material as THREE.SpriteMaterial).opacity = midOpacity;
    (this.haloSprite.material as THREE.SpriteMaterial).opacity = haloOpacity;
  }

  private setRingScale(scale: number, opacity: number): void {
    for (const ring of this.rings) {
      ring.scale.setScalar(scale);
      (ring.material as THREE.MeshBasicMaterial).opacity = opacity;
    }
  }

  private setSpikeIntensity(scale: number, opacity: number): void {
    for (const spike of this.spikes) {
      spike.scale.setScalar(scale);
      (spike.material as THREE.MeshBasicMaterial).opacity = opacity;
    }
  }

  private updateAnimation(dt: number): void {
    // Smoothly ease the whole core toward the state's target color rather
    // than snapping — reads as a deliberate mood shift, not a UI glitch.
    this.currentColor.lerp(this.targetColor, Math.min(1, dt * 4));
    (this.midSprite.material as THREE.SpriteMaterial).color.copy(this.currentColor);
    (this.shellMaterial as THREE.PointsMaterial).color.copy(this.currentColor);
    (this.coreWire.material as THREE.LineBasicMaterial).color.copy(this.currentColor);
    for (const ring of this.rings) (ring.material as THREE.MeshBasicMaterial).color.copy(this.currentColor);
    for (const spike of this.spikes) (spike.material as THREE.MeshBasicMaterial).color.copy(this.currentColor);

    // Particle shell always drifts gently, regardless of state — this is
    // what keeps the orb feeling "alive" even at rest.
    this.shellPoints.rotation.y += dt * 0.05;
    this.dust.rotation.y += dt * 0.012;
    this.dust.rotation.x += dt * 0.004;
    this.dust.position.y = Math.sin(this.elapsed * 0.12) * 0.035;

    switch (this.state) {
      case "IDLE":
        this.targetColor.copy(this.getAutomaticCoreColor());
        this.coreGroup.rotation.y += dt * 0.12;
        this.coreWire.rotation.x += dt * 0.05;
        this.setGlow(1, 0.55 + Math.sin(this.elapsed * 0.6) * 0.06, 0.4, 0.28);
        this.setRingScale(1, 0.14);
        this.setSpikeIntensity(1, 0.32 + Math.sin(this.elapsed * 0.6) * 0.05);
        break;

      case "LISTENING":
        this.targetColor.copy(this.getAutomaticCoreColor());
        this.coreGroup.rotation.y += dt * 0.18;
        this.setGlow(1 + this.audioLevel * 0.35, 0.7 + this.audioLevel * 0.3, 0.45 + this.audioLevel * 0.35, 0.3 + this.audioLevel * 0.3);
        this.setRingScale(1 + this.audioLevel * 0.45, 0.22 + this.audioLevel * 0.35);
        this.setSpikeIntensity(1 + this.audioLevel * 0.5, 0.35 + this.audioLevel * 0.4);
        break;

      case "THINKING":
        this.targetColor.copy(this.getAutomaticCoreColor());
        this.coreGroup.rotation.y += dt * 0.7;
        this.coreGroup.rotation.x += dt * 0.3;
        this.shellPoints.rotation.y += dt * 0.4;
        this.setGlow(1.05, 0.65 + Math.sin(this.elapsed * 4) * 0.2, 0.5, 0.3);
        this.setRingScale(1.08, 0.22);
        this.setSpikeIntensity(1.05, 0.38 + Math.sin(this.elapsed * 4) * 0.12);
        break;

      case "SPEAKING": {
        // No real amplitude source for TTS output — driven by elapsed
        // time instead of a fabricated level (see setAudioLevel doc).
        const pulse = 0.5 + Math.sin(this.elapsed * 6) * 0.5;
        this.targetColor.copy(this.getAutomaticCoreColor());
        this.coreGroup.rotation.y += dt * 0.25;
        this.setGlow(1 + pulse * 0.18, 0.7 + pulse * 0.2, 0.48 + pulse * 0.12, 0.3 + pulse * 0.1);
        this.setRingScale(1.05 + pulse * 0.1, 0.24 + pulse * 0.1);
        this.setSpikeIntensity(1 + pulse * 0.15, 0.35 + pulse * 0.15);
        break;
      }

      case "EXECUTING":
        this.targetColor.setHex(0xffb84d);
        this.coreGroup.rotation.y += dt * 1.3;
        this.coreGroup.rotation.z += dt * 0.5;
        this.shellPoints.rotation.y += dt * 0.9;
        this.setGlow(1.15, 0.85, 0.55, 0.34);
        this.setRingScale(1.18, 0.34);
        this.setSpikeIntensity(1.2, 0.55);
        break;

      case "WAITING_CONFIRMATION":
        this.targetColor.setHex(0xffb84d);
        this.coreGroup.rotation.y += dt * 0.04;
        this.setGlow(1.02 + Math.sin(this.elapsed * 1.5) * 0.04, 0.6 + Math.sin(this.elapsed * 1.5) * 0.15, 0.42, 0.26);
        this.setRingScale(1.03 + Math.sin(this.elapsed * 1.5) * 0.04, 0.2);
        this.setSpikeIntensity(1, 0.3 + Math.sin(this.elapsed * 1.5) * 0.08);
        break;

      case "ERROR":
        // Restrained — per spec section 9's explicit instruction.
        this.targetColor.setHex(0xff5c5c);
        this.coreGroup.rotation.y += dt * 0.04;
        this.setGlow(0.92, 0.4, 0.28, 0.16);
        this.setRingScale(0.92, 0.1);
        this.setSpikeIntensity(0.85, 0.14);
        break;

      case "OFFLINE":
        this.targetColor.setHex(0x7d93a3);
        this.setGlow(0.8, 0.18, 0.12, 0.08);
        this.setRingScale(0.85, 0.05);
        this.setSpikeIntensity(0.75, 0.05);
        break;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.animationHandle !== null) {
      cancelAnimationFrame(this.animationHandle);
      this.animationHandle = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.coreWire.geometry.dispose();
    (this.coreWire.material as THREE.Material).dispose();
    this.shellPoints.geometry.dispose();
    this.shellMaterial.dispose();
    this.dust.geometry.dispose();
    (this.dust.material as THREE.Material).dispose();
    for (const sprite of [this.haloSprite, this.midSprite, this.hotSprite]) {
      (sprite.material as THREE.SpriteMaterial).map?.dispose();
      (sprite.material as THREE.SpriteMaterial).dispose();
    }
    for (const ring of this.rings) {
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
    }
    for (const spike of this.spikes) {
      spike.geometry.dispose();
      (spike.material as THREE.Material).dispose();
    }

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
      this.renderer = null;
    }
  }
}

function qualityPointCount(quality: JarvisAnimationQuality, low: number, medium: number, high: number): number {
  return quality === "low" ? low : quality === "medium" ? medium : high;
}
