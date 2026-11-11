import { AmbientLight, Box3, Color, DirectionalLight, Group, HemisphereLight, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class Viewer {
  private scene = new Scene();
  private camera = new PerspectiveCamera(35, 1, 0.1, 5000);
  private renderer: WebGLRenderer;
  private controls: OrbitControls;
  private current?: Group;
  private host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
    this.scene.background = new Color('#e9e9e1');
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D model preview. Drag to rotate; scroll or pinch to zoom.');
    this.renderer.domElement.setAttribute('role', 'img');
    host.append(this.renderer.domElement);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 35;
    this.controls.maxDistance = 1100;
    this.scene.add(new AmbientLight(0xffffff, 1.1), new HemisphereLight(0xffffff, 0x7d867a, 2));
    const key = new DirectionalLight(0xfff6e5, 3.4);
    key.position.set(-100, 150, 300);
    this.scene.add(key);
    const fill = new DirectionalLight(0xffffff, 1);
    fill.position.set(100, -100, 100);
    this.scene.add(fill);
    new ResizeObserver(() => this.resize()).observe(host);
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
    this.resize();
  }

  show(group: Group, reset = false): void {
    if (this.current) this.scene.remove(this.current);
    this.current = group;
    this.scene.add(group);
    if (reset) this.reset();
  }

  reset(top = false): void {
    if (!this.current) return;
    const box = new Box3().setFromObject(this.current);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const distance = Math.max(size.y, size.x / this.camera.aspect) * 1.95;
    this.controls.target.copy(center);
    this.camera.position.set(center.x + (top ? 0 : distance * 0.24), center.y - (top ? 0.01 : distance * 0.48), center.z + distance);
    this.controls.update();
  }

  private resize(): void {
    const width = this.host.clientWidth, height = this.host.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    if (this.current) this.reset();
  }
}
