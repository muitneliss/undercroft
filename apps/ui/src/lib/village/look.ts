/**
 * How the village is photographed: a model village on a desk, under a warm lamp, shot with a
 * tilt-shift lens (ADR 0115).
 *
 * In order:
 *
 *   - the LIGHT: a warm key from the north-west casting soft shadows, a sky-and-grass fill, and a
 *     dim room reflected in anything glossy (the lake);
 *   - the board casts its own shadow on the page it stands on (a shadow catcher under it);
 *   - the INK pass draws the scene with its Ink outlines (`OutlineEffect`);
 *   - ambient OCCLUSION darkens every crease: where a roof meets a wall, a figure meets the road;
 *   - the TILT-SHIFT keeps a band through the village sharp and softens the near and far edges,
 *     which is what makes a real place read as a miniature;
 *   - the PRINT pass lays the page's own grain over everything and darkens the corners a little;
 *   - the OUTPUT pass maps the light into the page's colours with Neutral tone mapping, which
 *     keeps the design system's hues where they are.
 *
 * Every step is deterministic, so a settled frame photographs the same way twice
 * (`docs/runbook/visual-regression.md`).
 */

import {
  type Box3,
  type Camera,
  Color,
  DirectionalLight,
  HalfFloatType,
  HemisphereLight,
  Mesh,
  NeutralToneMapping,
  PCFShadowMap,
  PlaneGeometry,
  PMREMGenerator,
  type Scene,
  ShadowMaterial,
  Vector2,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { OutlineEffect } from "three/addons/effects/OutlineEffect.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { HorizontalTiltShiftShader } from "three/addons/shaders/HorizontalTiltShiftShader.js";
import { VerticalTiltShiftShader } from "three/addons/shaders/VerticalTiltShiftShader.js";

import { InkPass } from "@/lib/village/inkPass.ts";
import { mix, RAMPS, type Tokens } from "@/lib/village/palette.ts";

/** The key light: warm, from the north-west and high, so shadows fall toward the reader. */
const KEY_AT = { x: -11, y: 19, z: 7 } as const;
const KEY_STRENGTH = 2.4;
const FILL_STRENGTH = 1.15;
const ROOM_STRENGTH = 0.32;
const SHADOW_MAP = 2048;
/** Samples per pixel of ambient occlusion: past eight the creases look no different. */
const OCCLUSION_SAMPLES = 8;
/** How soft a shadow's edge is, in shadow-map texels. */
const SHADOW_SOFTNESS = 3;
/** Half the width of the square the key light's shadows are drawn over: the whole board. */
const SHADOW_REACH = 17;
/** How dark the board's shadow on the page is. */
const DESK_SHADOW = 0.2;
/** Where the page lies: just under the board's foot. */
const DESK_LEVEL = -1.02;
const OUTLINE_THICKNESS = 0.0022;
/** How far from the sharp band the tilt-shift blur reaches, in pixels at the frame's edge. */
const TILT_BLUR = 2.4;
/** Where the sharp band runs, as a share of the frame's height from the bottom. */
const TILT_FOCUS = 0.5;

/** The page's grain and a lamp's falloff toward the corners, laid over the whole frame. */
const PrintShader = {
  name: "VillagePrintShader",
  uniforms: {
    tDiffuse: { value: null },
    size: { value: new Vector2(1, 1) },
    shade: { value: new Color() },
    corner: { value: 0.32 },
    grain: { value: 0.035 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 size;
    uniform vec3 shade;
    uniform float corner;
    uniform float grain;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 colour = texture2D(tDiffuse, vUv);
      vec2 fromCentre = (vUv - 0.5) * vec2(size.x / size.y, 1.0);
      float falloff = smoothstep(0.55, 1.25, length(fromCentre) * 1.3);
      colour.rgb = mix(colour.rgb, colour.rgb * shade, falloff * corner);
      colour.rgb *= 1.0 + (hash(floor(vUv * size)) - 0.5) * grain;
      gl_FragColor = colour;
    }`,
};

/** A dim room, reflected in whatever is glossy: the lake. */
function roomFor(renderer: WebGLRenderer): WebGLRenderTarget {
  const pmrem = new PMREMGenerator(renderer);
  const room = pmrem.fromScene(new RoomEnvironment(), 0.04);
  pmrem.dispose();
  return room;
}

/** The page the board stands on, seen only where the board's shadow falls on it. */
function deskUnder(shadow: ShadowMaterial): Mesh {
  shadow.userData = { outlineParameters: { visible: false } };
  const desk = new Mesh(new PlaneGeometry(120, 120), shadow);
  desk.rotation.x = -Math.PI / 2;
  desk.position.y = DESK_LEVEL;
  desk.receiveShadow = true;
  return desk;
}

/** The warm key light, high in the north-west, casting the board's soft shadows. */
function keyLight(): DirectionalLight {
  const warmth = new Color(mix(RAMPS.chrome[7] ?? "#ffffff", "#ffffff", 0.55));
  const key = new DirectionalLight(warmth, KEY_STRENGTH);
  key.position.set(KEY_AT.x, KEY_AT.y, KEY_AT.z);
  key.castShadow = true;
  key.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  key.shadow.camera.left = -SHADOW_REACH;
  key.shadow.camera.right = SHADOW_REACH;
  key.shadow.camera.top = SHADOW_REACH;
  key.shadow.camera.bottom = -SHADOW_REACH;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = SHADOW_SOFTNESS;
  return key;
}

export class Look {
  private readonly composer: EffectComposer;
  private readonly occlusion: GTAOPass;
  private readonly tiltAcross: ShaderPass;
  private readonly tiltDown: ShaderPass;
  private readonly print: ShaderPass;
  private readonly room: WebGLRenderTarget;
  private readonly desk: Mesh;
  private readonly key: DirectionalLight;
  private readonly deskShadow: ShadowMaterial;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera, tokens: Tokens) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.toneMapping = NeutralToneMapping;
    renderer.setClearColor(new Color(tokens.page), 1);
    this.room = roomFor(renderer);
    scene.environment = this.room.texture;
    scene.environmentIntensity = ROOM_STRENGTH;
    this.deskShadow = new ShadowMaterial({ color: new Color(tokens.ink), opacity: DESK_SHADOW });
    this.desk = deskUnder(this.deskShadow);
    const key = keyLight();
    this.key = key;
    const fill = new HemisphereLight(
      new Color(tokens.leaf),
      new Color(RAMPS.grass[5] ?? tokens.bone),
      FILL_STRENGTH,
    );
    scene.add(key, key.target, fill, this.desk);

    const size = renderer.getDrawingBufferSize(new Vector2());
    this.composer = new EffectComposer(
      renderer,
      new WebGLRenderTarget(size.x, size.y, { samples: 4, type: HalfFloatType }),
    );
    this.occlusion = new GTAOPass(scene, camera, size.x, size.y);
    this.occlusion.updateGtaoMaterial({
      radius: 0.6,
      distanceFallOff: 1,
      thickness: 1,
      scale: 1.2,
      samples: OCCLUSION_SAMPLES,
    });
    this.occlusion.blendIntensity = 0.85;
    this.tiltAcross = new ShaderPass(HorizontalTiltShiftShader);
    this.tiltDown = new ShaderPass(VerticalTiltShiftShader);
    this.print = new ShaderPass(PrintShader);
    this.print.uniforms.shade?.value.set(new Color(mix(tokens.bone, tokens.ink, 0.35)));
    const effect = new OutlineEffect(renderer, {
      defaultThickness: OUTLINE_THICKNESS,
      defaultColor: new Color(tokens.ink).toArray(),
    });
    for (const pass of [
      new InkPass(effect, scene, camera),
      this.occlusion,
      this.tiltAcross,
      this.tiltDown,
      this.print,
      new OutputPass(),
    ]) {
      this.composer.addPass(pass);
    }
  }

  /** The frame's size in CSS pixels, at the renderer's pixel ratio. */
  setSize(width: number, height: number, ratio: number): void {
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(width, height);
    const { h, r: acrossFocus } = this.tiltAcross.uniforms;
    const { v, r: downFocus } = this.tiltDown.uniforms;
    if (
      h !== undefined &&
      v !== undefined &&
      acrossFocus !== undefined &&
      downFocus !== undefined
    ) {
      h.value = TILT_BLUR / (width * ratio);
      v.value = TILT_BLUR / (height * ratio);
      acrossFocus.value = TILT_FOCUS;
      downFocus.value = TILT_FOCUS;
    }
    this.print.uniforms.size?.value.set(width * ratio, height * ratio);
  }

  /**
   * Fits the light to the world in view: the key stands off the world's middle at its bearing,
   * and its shadows are drawn over the whole of it, whether a run's short street or a lineage of
   * hundreds of buildings.
   */
  frame(box: Box3): void {
    const middle = box.getCenter(new Vector3());
    const reach = Math.max(SHADOW_REACH, box.getSize(new Vector3()).length() / 2 + 2);
    this.key.position.set(middle.x + KEY_AT.x, KEY_AT.y, middle.z + KEY_AT.z);
    this.key.target.position.set(middle.x, 0, middle.z);
    this.key.target.updateMatrixWorld();
    const shadow = this.key.shadow.camera;
    shadow.left = -reach;
    shadow.right = reach;
    shadow.top = reach;
    shadow.bottom = -reach;
    shadow.far = reach * 4;
    shadow.updateProjectionMatrix();
    this.desk.position.set(middle.x, DESK_LEVEL, middle.z);
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
    this.occlusion.dispose();
    this.room.dispose();
    this.desk.geometry.dispose();
    this.deskShadow.dispose();
  }
}
