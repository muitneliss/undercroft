/**
 * The scene drawn with its Ink outlines, as the first pass of the village's composer
 * (`look.ts`). Three's `OutlineEffect` draws to whatever the renderer's target is, so this pass
 * points the renderer at the composer's buffer and lets the effect draw there.
 */

import type { Camera, Scene, WebGLRenderer, WebGLRenderTarget } from "three";
import type { OutlineEffect } from "three/addons/effects/OutlineEffect.js";
import { Pass } from "three/addons/postprocessing/Pass.js";

export class InkPass extends Pass {
  private readonly effect: OutlineEffect;
  private readonly scene: Scene;
  private readonly camera: Camera;

  constructor(effect: OutlineEffect, scene: Scene, camera: Camera) {
    super();
    this.effect = effect;
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = false;
  }

  override render(
    renderer: WebGLRenderer,
    _write: WebGLRenderTarget,
    read: WebGLRenderTarget,
  ): void {
    renderer.setRenderTarget(this.renderToScreen ? null : read);
    renderer.clear();
    this.effect.render(this.scene, this.camera);
  }
}
