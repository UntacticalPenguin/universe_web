import * as THREE from "three"
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js"
import { luminanceWeights } from "./light.ts"

export function createToneMap(texture: THREE.Texture) {
  const uniforms = { light: { value: texture }, exposure: { value: 1 } }
  const quad = new FullScreenQuad(
    new THREE.ShaderMaterial({
      uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: "void main() { gl_Position = vec4(position.xy, 0., 1.); }",
      fragmentShader: `
      uniform sampler2D light;
      uniform float exposure;
      void main() {
        vec3 rgb = min(texelFetch(light, ivec2(gl_FragCoord.xy), 0).rgb, vec3(65504.0)) * exposure;
        float L = dot(rgb, vec3(${luminanceWeights.join(",")}));
        rgb *= (1.0 + L / 16.0) / (1.0 + L);
        rgb /= max(1.0, max(rgb.r, max(rgb.g, rgb.b)));
        gl_FragColor = vec4(rgb, 1.);
        #include <colorspace_fragment>
      }`,
    }),
  )
  return (renderer: THREE.WebGLRenderer, exposure: number) => {
    uniforms.exposure.value = exposure
    renderer.setRenderTarget(null)
    quad.render(renderer)
  }
}
