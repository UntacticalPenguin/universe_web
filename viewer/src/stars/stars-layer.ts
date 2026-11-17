import * as THREE from "three"
import { createColourLut } from "./colour-lut.ts"
import { M_RANGE, type StarData } from "./load-stars.ts"

/** Brightness and size follow the apparent magnitude at the camera: m = M + 5 log10(d / 10 pc). `pointSizeOf` mirrors the shader for picking. */
const vertexShader = /* glsl */ `
  attribute float aAbsMag;
  attribute float aColour;
  uniform sampler2D uLut;
  uniform float uMagLimit;
  uniform float uExposure;
  uniform float uPixelRatio;
  varying vec3 vColour;
  varying float vIntensity;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    float parsecs = max(length(viewPosition.xyz), 1e-6);
    float absoluteMag = mix(${M_RANGE[0].toFixed(1)}, ${M_RANGE[1].toFixed(1)}, aAbsMag);
    float apparentMag = absoluteMag + 5.0 * log2(parsecs / 10.0) * 0.30103;

    if (apparentMag > uMagLimit) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    float flux = pow(10.0, -0.4 * (apparentMag - uMagLimit)) * uExposure;
    vIntensity = 1.0 - exp(-0.08 * flux);
    vColour = texture2D(uLut, vec2(aColour, 0.5)).rgb;
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = clamp(2.0 + 1.6 * log(1.0 + 0.02 * flux), 2.0, 14.0) * uPixelRatio;
  }
`

const fragmentShader = /* glsl */ `
  varying vec3 vColour;
  varying float vIntensity;

  void main() {
    vec2 offset = gl_PointCoord - 0.5;
    float r2 = dot(offset, offset) * 4.0;
    if (r2 > 1.0) discard;
    gl_FragColor = vec4(vColour * vIntensity * exp(-r2 * 4.0), 1.0);
    #include <colorspace_fragment>
  }
`

export type StarsLayer = ReturnType<typeof createStarsLayer>

export function createStarsLayer(data: StarData, pixelRatio: number) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3))
  geometry.setAttribute("aAbsMag", new THREE.BufferAttribute(data.absMag, 1, true))
  geometry.setAttribute("aColour", new THREE.BufferAttribute(data.colour, 1, true))

  const uniforms = {
    uLut: { value: createColourLut() },
    uMagLimit: { value: 12 },
    uExposure: { value: 1 },
    uPixelRatio: { value: pixelRatio },
  }
  const material = new THREE.ShaderMaterial({
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
    setMagLimit: (magnitude: number) => (uniforms.uMagLimit.value = magnitude),
    setExposure: (stops: number) => (uniforms.uExposure.value = 2 ** stops),
  }
}

/** On-screen diameter in CSS pixels of a star of `apparentMag`, as the vertex shader draws it. */
export function pointSizeOf(apparentMag: number, magLimit: number, exposureStops: number) {
  const flux = 10 ** (-0.4 * (apparentMag - magLimit)) * 2 ** exposureStops
  return Math.min(14, Math.max(2, 2 + 1.6 * Math.log(1 + 0.02 * flux)))
}
