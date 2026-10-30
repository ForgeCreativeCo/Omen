import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/examples/jsm/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/examples/jsm/shaders/VerticalTiltShiftShader.js';

/** Blur strength in pixels-ish at the screen edges, and the in-focus band's center (0 = bottom). */
const TILT_AMOUNT = 2.2;
const FOCUS_Y = 0.48;

/**
 * Tilt-shift (two separable blur passes that grow away from a horizontal focus
 * band) to sell the miniature. When disabled we skip the composer entirely.
 */
export class PostFX {
  enabled = true;
  private readonly composer: EffectComposer;
  private readonly hPass: ShaderPass;
  private readonly vPass: ShaderPass;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.hPass = new ShaderPass(HorizontalTiltShiftShader);
    this.vPass = new ShaderPass(VerticalTiltShiftShader);
    this.hPass.uniforms.r!.value = FOCUS_Y;
    this.vPass.uniforms.r!.value = FOCUS_Y;
    this.composer.addPass(this.hPass);
    this.composer.addPass(this.vPass);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.hPass.uniforms.h!.value = TILT_AMOUNT / w;
    this.vPass.uniforms.v!.value = TILT_AMOUNT / h;
  }

  render(dt: number): void {
    if (this.enabled) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
