import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * # Status: UNVERIFIED (no browser/WebGL context available in this sandbox).
 *
 * Written against Three.js's documented API (r160+ style imports), and
 * structured so every resource it creates has a matching disposal path —
 * but I could not actually instantiate a WebGLRenderer or confirm this
 * runs without error, since that requires a real browser. Treat this as
 * "should work, needs a first real run to confirm," same posture as the
 * MediaPipe providers in Phase 3.
 *
 * Owns exactly one render loop, one WebGLRenderer, one Scene, one Camera.
 * `dispose()` is the single place responsible for tearing all of it back
 * down — every `mount()` must be paired with a `dispose()` (React's
 * `useEffect` cleanup in `Viewport.tsx` calls this), per spec section 4's
 * "starting and closing the design studio must not leave [...] running
 * unnecessarily."
 */
export class SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer | null = null;
  private controls: OrbitControls | null = null;
  private container: HTMLElement | null = null;

  private keyLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private ambientLight: THREE.AmbientLight;
  private grid: THREE.GridHelper;
  private axes: THREE.AxesHelper;

  private animationHandle: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private disposed = false;

  // Tracks every geometry/material/texture WE created (not ones owned by
  // loaded GLTF assets, which bring their own disposal via their root
  // object's traverse) so dispose() can release them deterministically —
  // spec section 4/30's "dispose unused geometries/materials/textures".
  private ownedDisposables: Array<{ dispose: () => void }> = [];

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05080c); // matches --bg-void

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
    this.camera.position.set(0.6, 0.4, 0.6);

    this.ambientLight = new THREE.AmbientLight(0x8899aa, 0.4);
    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    this.keyLight.position.set(1, 1.5, 1);
    this.fillLight = new THREE.DirectionalLight(0x4ee1ff, 0.35);
    this.fillLight.position.set(-1, 0.5, -0.5);
    this.rimLight = new THREE.DirectionalLight(0xffffff, 0.5);
    this.rimLight.position.set(0, 1, -1.5);
    this.scene.add(this.ambientLight, this.keyLight, this.fillLight, this.rimLight);

    this.grid = new THREE.GridHelper(2, 20, 0x2a3540, 0x1a222a);
    this.axes = new THREE.AxesHelper(0.3);
    this.scene.add(this.grid, this.axes);
  }

  /** Attaches the renderer to a real DOM element. Call once; call
   * `dispose()` before mounting again (e.g. on Design Studio re-open). */
  mount(container: HTMLElement): void {
    if (this.renderer) {
      throw new Error("SceneManager already mounted — call dispose() before mounting again.");
    }
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.resize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.resizeObserver = new ResizeObserver(() => {
      if (!this.container) return;
      this.resize(this.container.clientWidth, this.container.clientHeight);
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
    if (this.animationHandle !== null) return; // guard against a duplicate loop, same pattern as VisionPipeline
    const tick = () => {
      if (this.disposed) return;
      this.controls?.update();
      if (this.renderer) this.renderer.render(this.scene, this.camera);
      this.animationHandle = requestAnimationFrame(tick);
    };
    this.animationHandle = requestAnimationFrame(tick);
  }

  setWireframe(enabled: boolean): void {
    this.scene.traverse((obj: THREE.Object3D) => {
      if (obj instanceof THREE.Mesh && obj.material instanceof THREE.Material) {
        (obj.material as THREE.MeshStandardMaterial).wireframe = enabled;
      }
    });
  }

  resetCamera(): void {
    this.camera.position.set(0.6, 0.4, 0.6);
    this.controls?.target.set(0, 0, 0);
    this.controls?.update();
  }

  trackDisposable(d: { dispose: () => void }): void {
    this.ownedDisposables.push(d);
  }

  getRendererInfo(): { drawCalls: number; triangles: number } | null {
    if (!this.renderer) return null;
    return { drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
  }

  /** Full teardown: stops the render loop, disconnects the resize
   * observer, disposes every tracked geometry/material/texture, disposes
   * the renderer's own GL context, and removes the canvas from the DOM.
   * This is the counterpart to `mount()` — see the class doc comment. */
  dispose(): void {
    this.disposed = true;
    if (this.animationHandle !== null) {
      cancelAnimationFrame(this.animationHandle);
      this.animationHandle = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.controls?.dispose();
    this.controls = null;

    for (const d of this.ownedDisposables) d.dispose();
    this.ownedDisposables = [];

    this.scene.traverse((obj: THREE.Object3D) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of materials) disposeMaterial(m);
      }
    });

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
      this.renderer = null;
    }
    this.container = null;
  }
}

function disposeMaterial(material: THREE.Material): void {
  // Dispose any texture maps a standard/physical material might be holding.
  const maybeTextured = material as unknown as Record<string, THREE.Texture | undefined>;
  for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "envMap"]) {
    maybeTextured[key]?.dispose?.();
  }
  material.dispose();
}
