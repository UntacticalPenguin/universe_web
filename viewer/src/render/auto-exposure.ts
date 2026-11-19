import * as THREE from "three"
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js"
import { createHdrTarget } from "./hdr-target.ts"
import { luminanceWeights } from "./light.ts"

/** Each texel stores a mean. Edge tiles carry the area they actually cover in the original image. */
export function createLuminanceMeter(hdr: THREE.WebGLRenderTarget) {
  const levels: THREE.WebGLRenderTarget[] = []
  const uniforms = {
    source: { value: hdr.texture },
    frameSize: { value: new THREE.Vector2() },
    tileSize: { value: 1 },
  }
  const quad = new FullScreenQuad(
    new THREE.ShaderMaterial({
      uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: "void main() { gl_Position = vec4(position.xy, 0., 1.); }",
      fragmentShader: `
      uniform sampler2D source;
      uniform vec2 frameSize;
      uniform float tileSize;
      void main() {
        ivec2 base = 2 * ivec2(gl_FragCoord.xy);
        float sum = 0., weight = 0.;
        for (int y=0; y<2; ++y) for (int x=0; x<2; ++x) {
          ivec2 p = base + ivec2(x,y);
          vec2 extent = clamp(frameSize / tileSize - vec2(p), 0., 1.);
          float area = extent.x * extent.y;
          if (area > 0.) {
            vec3 rgb = min(texelFetch(source, p, 0).rgb, vec3(65504.0));
            sum += area * dot(rgb, vec3(${luminanceWeights.join(",")}));
            weight += area;
          }
        }
        gl_FragColor = vec4(vec3(sum / weight), 1.);
      }`,
    }),
  )
  const pixel = new Float32Array(4)
  return (renderer: THREE.WebGLRenderer) => {
    if (uniforms.frameSize.value.x !== hdr.width || uniforms.frameSize.value.y !== hdr.height) {
      levels.splice(0).forEach((level) => level.dispose())
      uniforms.frameSize.value.set(hdr.width, hdr.height)
      let { width, height } = hdr
      do {
        width = Math.ceil(width / 2)
        height = Math.ceil(height / 2)
        levels.push(createHdrTarget(width, height, width * height === 1 ? THREE.FloatType : THREE.HalfFloatType))
      } while (width * height > 1)
    }
    uniforms.tileSize.value = 1
    uniforms.source.value = hdr.texture
    for (const level of levels) {
      renderer.setRenderTarget(level)
      quad.render(renderer)
      uniforms.source.value = level.texture
      uniforms.tileSize.value *= 2
    }
    renderer.readRenderTargetPixels(levels[levels.length - 1], 0, 0, 1, 1, pixel)
    return pixel[0]
  }
}
