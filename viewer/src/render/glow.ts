import * as THREE from "three"
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js"
import { createHdrTarget } from "./hdr-target.ts"

/** Downsample with a tent filter. Each successive texture spreads light over twice the radius. */
export function createGlow(hdr: THREE.WebGLRenderTarget) {
  const levels = Array.from({ length: 5 }, () => {
    const target = createHdrTarget(1, 1)
    target.texture.minFilter = target.texture.magFilter = THREE.LinearFilter
    return target
  })
  const uniforms = { source: { value: hdr.texture } }
  const quad = new FullScreenQuad(
    new THREE.ShaderMaterial({
      uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: "varying vec2 uvScreen; void main(){ uvScreen = uv; gl_Position = vec4(position.xy, 0., 1.); }",
      fragmentShader: `
      varying vec2 uvScreen;
      uniform sampler2D source;
      void main() {
        vec2 texel = 1.0 / vec2(textureSize(source,0));
        vec3 sum = vec3(0.);
        for(int y=-1; y<=1; ++y) for(int x=-1; x<=1; ++x) {
          float w = float((2-abs(x))*(2-abs(y))) / 16.0;
          sum += min(texture2D(source,uvScreen+vec2(x,y)*texel).rgb, vec3(65504.)) * w;
        }
        gl_FragColor = vec4(sum,1.);
      }`,
    }),
  )
  return {
    textures: levels.map((level) => level.texture),
    render(renderer: THREE.WebGLRenderer) {
      let source = hdr
      for (const level of levels) {
        level.setSize(Math.ceil(source.width / 2), Math.ceil(source.height / 2))
        uniforms.source.value = source.texture
        renderer.setRenderTarget(level)
        quad.render(renderer)
        source = level
      }
    },
  }
}
