import * as THREE from "three"
import { luminanceWeights, profileArea } from "../render/light.ts"
export { pointSizeOf } from "../render/light.ts"
import { createColourLut } from "./colour-lut.ts"
import { M_RANGE, type StarData } from "./load-stars.ts"

/** Brightness and size follow the apparent magnitude at the camera: m = M + 5 log10(d / 10 pc). `pointSizeOf` mirrors the shader for picking. */
const vertexShader = /* glsl */ `
  attribute float aAbsMag;
  attribute float aColour;
  attribute float aTemperature;
  attribute float aExtinction;
  attribute float aReddening;
  uniform bool uDust;
  uniform bool uSpikes;
  uniform sampler2D uLut;
  uniform float uMagLimit;
  uniform float uExposure;
  uniform float uPixelRatio;
  #ifdef TILE
  uniform vec3 uOffset;
  uniform float uHalf;
  #endif
  varying vec3 vColour;
  varying float vIntensity;
  varying float vSpikeWidth;

  void main() {
    #ifdef TILE
    vec4 viewPosition = vec4(mat3(viewMatrix) * (uOffset + position*uHalf),1.);
    #else
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    #endif
    float parsecs = max(length(viewPosition.xyz), 1e-6);
    float absoluteMag = mix(${M_RANGE[0].toFixed(1)}, ${M_RANGE[1].toFixed(1)}, aAbsMag);
    if (!uDust && aExtinction < 255.0) absoluteMag -= 8.0 * aExtinction / 254.0;
    float apparentMag = absoluteMag + 5.0 * log2(parsecs / 10.0) * 0.30103;

    if (apparentMag > uMagLimit) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    float flux = pow(10.0, -0.4 * (apparentMag - 6.0));
    float bp = mix(-0.5, 4.5, aColour);
    if (!uDust && aReddening < 255.0) bp -= 4.0 * aReddening / 254.0;
    float kelvin = clamp(5040.0 / (0.4929 + 0.5092 * bp - 0.0353 * bp * bp), 2000.0, 40000.0);
    if (!uDust && aTemperature < 255.0) kelvin = pow(10.0, mix(3.3, 4.7, aTemperature / 254.0));
    float lookup = clamp(log(kelvin / 2000.0) / log(25.0), 0.0, 1.0);
    vec3 rgb = texture2D(uLut, vec2((lookup * 255.0 + 0.5) / 256.0, 0.5)).rgb;
    vColour = rgb / dot(rgb, vec3(${luminanceWeights.join(",")}));
    gl_Position = projectionMatrix * viewPosition;
    float sizeCss = clamp(1.5 + 2.5 * log2(1.0 + flux * uExposure) * 0.30103, 1.5, uSpikes ? 48.0 : 16.0);
    gl_PointSize = sizeCss * uPixelRatio;
    vSpikeWidth = uSpikes && sizeCss >= 8.0 ? 1.0 / sizeCss : 0.0;
    vIntensity = flux / (${profileArea} * gl_PointSize * gl_PointSize);
  }
`

const fragmentShader = /* glsl */ `
  varying vec3 vColour;
  varying float vIntensity;
  varying float vSpikeWidth;

  void main() {
    vec2 offset = gl_PointCoord - 0.5;
    float r2 = dot(offset, offset) * 4.0;
    float profile = r2 > 1.0 ? 0.0 : exp(-4.0 * r2);
    if (vSpikeWidth > 0.0) {
      // Two tapered lines. Each product of tents integrates to width / 2 on the unit sprite.
      vec2 along = 1.0 - 2.0 * abs(offset);
      vec2 across = max(1.0 - abs(offset) / vSpikeWidth, 0.0);
      float crossProfile = dot(along.xy, across.yx) / vSpikeWidth;
      profile = 0.97 * profile + 0.03 * ${profileArea} * crossProfile;
    }
    if (profile == 0.0) discard;
    gl_FragColor = vec4(vColour * vIntensity * profile, 1.0);
  }
`

export type StarsLayer = ReturnType<typeof createStarsLayer>

let sharedLut: THREE.DataTexture | undefined
export function createStarsLayer(data: StarData, pixelRatio: number, tile?: { offsets: Int16Array; half: number }, lut = (sharedLut ??= createColourLut())) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(tile?.offsets ?? data.positions, 3, !!tile))
  geometry.setAttribute("aAbsMag", new THREE.BufferAttribute(data.absMag, 1, true))
  geometry.setAttribute("aColour", new THREE.BufferAttribute(data.colour, 1, true))

  geometry.setAttribute("aTemperature", new THREE.BufferAttribute(data.teff, 1))
  geometry.setAttribute("aExtinction", new THREE.BufferAttribute(data.extinction, 1))
  geometry.setAttribute("aReddening", new THREE.BufferAttribute(data.reddening, 1))
  const uniforms = {
    uOffset: { value: new THREE.Vector3() },
    uHalf: { value: tile?.half ?? 1 },
    uDust: { value: true },
    uSpikes: { value: false },
    uLut: { value: lut },
    uMagLimit: { value: Infinity },
    uExposure: { value: 1 },
    uPixelRatio: { value: pixelRatio },
  }
  const material = new THREE.ShaderMaterial({
    defines: tile ? { TILE: 1 } : {},
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false

  return {
    points,
    offset: uniforms.uOffset.value,
    dispose: () => {
      geometry.dispose()
      material.dispose()
    },
    setDust: (enabled: boolean) => (uniforms.uDust.value = enabled),
    setSpikes: (enabled: boolean) => (uniforms.uSpikes.value = enabled),
    setMagLimit: (magnitude: number) => (uniforms.uMagLimit.value = magnitude),
    setExposure: (exposure: number) => (uniforms.uExposure.value = exposure),
  }
}
