import * as THREE from "three";
import type { JarvisState } from "../../orchestrator/JarvisStateMachine";

/**
 * # Status: UNVERIFIED (no WebGL context available in this sandbox).
 *
 * Reuses the SAME dark-glass Three.js rendering conventions Phase 4/5
 * already established — transparent-friendly scene, no new rendering
 * abstraction invented. Owns its own small scene rather than sharing
 * Phase 4/5's `GraphRenderer`, since a voice visualizer isn't a
 * `DesignObject` — no design-graph identity/undo/persistence, so wrapping
 * it in that machinery would be reuse of the wrong system.
 *
 * Each `JarvisState` gets genuinely distinct behavior (spec section 9),
 * not just a color change — see `updateAnimation`'s per-case comments.
 */
export class JarvisVisualizer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer | null = null;
  private core: THREE.Mesh;
  private rings: THREE.Mesh[] = [];
  private animationHandle: number | null = null;
  private disposed = false;
  private state: JarvisState = "IDLE";
  private audioLevel = 0; // 0..1, see setAudioLevel
  private elapsed = 0;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 0, 4);

    const coreGeometry = new THREE.IcosahedronGeometry(0.8, 2);
    const coreMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x4ee1ff), emissive: new THREE.Color(0x1a4a5c), emissiveIntensity: 0.4,
      roughness: 0.25, metalness: 0.6, transparent: true, opacity: 0.9,
    });
    this.core = new THREE.Mesh(coreGeometry, coreMaterial);
    this.scene.add(this.core);

    for (let i = 0; i < 3; i++) {
      const ringGeometry = new THREE.TorusGeometry(1.2 + i * 0.35, 0.015, 8, 64);
      const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x4ee1ff, transparent: true, opacity: 0.25 - i * 0.05 });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = Math.PI / 2 + i * 0.15;
      this.rings.push(ring);
      this.scene.add(ring);
    }

    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    const key = new THREE.DirectionalLight(0x4ee1ff, 0.8);
    key.position.set(2, 2, 3);
    this.scene.add(ambient, key);
  }

  setState(state: JarvisState): void {
    this.state = state;
  }

  /**
   * Feeds real audio amplitude (0..1) for LISTENING/SPEAKING states.
   * NEVER called with a synthesized/fake value when no real microphone or
   * TTS engine is producing audio — per spec section 9's explicit "do not
   * fake actual microphone audio when no microphone exists." When no real
   * source is available, callers should simply not call this method (it
   * defaults to 0, producing a calm/minimal ring animation).
   */
  setAudioLevel(level: number): void {
    this.audioLevel = Math.max(0, Math.min(1, level));
  }

  mount(container: HTMLElement): void {
    if (this.renderer) throw new Error("JarvisVisualizer already mounted — call dispose() first.");
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.resize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.resizeObserver = new ResizeObserver(() => this.resize(container.clientWidth, container.clientHeight));
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
    if (this.animationHandle !== null) return;
    let lastTime = performance.now();
    const tick = (now: number) => {
      if (this.disposed) return;
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      this.elapsed += dt;
      this.updateAnimation(dt);
      if (this.renderer) this.renderer.render(this.scene, this.camera);
      this.animationHandle = requestAnimationFrame(tick);
    };
    this.animationHandle = requestAnimationFrame(tick);
  }

  private updateAnimation(dt: number): void {
    const material = this.core.material as THREE.MeshPhysicalMaterial;

    switch (this.state) {
      case "IDLE":
        this.core.rotation.y += dt * 0.15;
        material.emissiveIntensity = 0.3;
        this.setRingScale(1, 0.15);
        break;

      case "LISTENING":
        this.core.rotation.y += dt * 0.2;
        material.emissiveIntensity = 0.4 + this.audioLevel * 0.4;
        this.setRingScale(1 + this.audioLevel * 0.5, 0.2 + this.audioLevel * 0.3);
        break;

      case "THINKING":
        this.core.rotation.y += dt * 0.6;
        this.core.rotation.x += dt * 0.25;
        material.emissiveIntensity = 0.5 + Math.sin(this.elapsed * 2) * 0.15;
        this.setRingScale(1.1, 0.2);
        break;

      case "SPEAKING":
        this.core.rotation.y += dt * 0.3;
        material.emissiveIntensity = 0.5 + this.audioLevel * 0.5;
        this.setRingScale(1 + this.audioLevel * 0.6, 0.25 + this.audioLevel * 0.35);
        material.color.setHex(0x4ee1ff);
        break;

      case "EXECUTING":
        this.core.rotation.y += dt * 1.2;
        this.core.rotation.z += dt * 0.4;
        material.emissiveIntensity = 0.6;
        material.color.setHex(0x4ee1ff);
        this.setRingScale(1.15, 0.3);
        break;

      case "WAITING_CONFIRMATION":
        this.core.rotation.y += dt * 0.05;
        material.color.setHex(0xffb84d);
        material.emissiveIntensity = 0.4 + Math.sin(this.elapsed * 1.5) * 0.2;
        this.setRingScale(1.05 + Math.sin(this.elapsed * 1.5) * 0.05, 0.2);
        break;

      case "ERROR":
        // Restrained — per spec section 9's explicit instruction.
        this.core.rotation.y += dt * 0.05;
        material.color.setHex(0xff5c5c);
        material.emissiveIntensity = 0.3;
        this.setRingScale(0.95, 0.1);
        break;

      case "OFFLINE":
        material.color.setHex(0x7d93a3);
        material.emissiveIntensity = 0.1;
        this.setRingScale(0.9, 0.05);
        break;
    }
  }

  private setRingScale(scale: number, opacity: number): void {
    for (const ring of this.rings) {
      ring.scale.setScalar(scale);
      (ring.material as THREE.MeshBasicMaterial).opacity = opacity;
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

    this.core.geometry.dispose();
    (this.core.material as THREE.Material).dispose();
    for (const ring of this.rings) {
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
    }

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
      this.renderer = null;
    }
  }
}
