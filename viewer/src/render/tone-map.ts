import * as THREE from "three"
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js"
import { luminanceWeights } from "./light.ts"

export function createToneMap(texture: THREE.Texture, halos: THREE.Texture[]) {
  const uniforms = { light: { value: texture }, halos: { value: halos }, glow: { value: 0.04 }, saturation: { value: 1 }, exposure: { value: 1 } }
  const quad = new FullScreenQuad(
    new THREE.ShaderMaterial({
      uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: "void main() { gl_Position = vec4(position.xy, 0., 1.); }",
      fragmentShader: `
      uniform sampler2D light;
      uniform float exposure, glow, saturation;
      uniform sampler2D halos[5];
      void main() {
        vec3 rgb = min(texelFetch(light, ivec2(gl_FragCoord.xy), 0).rgb, vec3(65504.0));
        if(glow > 0.) {
          vec2 uv = gl_FragCoord.xy / vec2(textureSize(light,0));
          // WebGL requires constant sampler-array indices.
          ${halos.map((_, i) => `rgb += glow * 0.2 * texture2D(halos[${i}],uv).rgb;`).join("\n")}
        }
        rgb *= exposure;
        float L = dot(rgb, vec3(${luminanceWeights.join(",")}));
        rgb *= (1.0 + L / 16.0) / (1.0 + L);
        float Y = dot(rgb, vec3(${luminanceWeights.join(",")}));
        rgb = max(vec3(0.), Y + saturation * (rgb - Y));
        rgb /= max(1.0, max(rgb.r, max(rgb.g, rgb.b)));
        gl_FragColor = vec4(rgb, 1.);
        #include <colorspace_fragment>
      }`,
    }),
  )
  return (renderer: THREE.WebGLRenderer, exposure: number, glow: number, saturation: number) => {
    uniforms.exposure.value = exposure
    uniforms.glow.value = glow
    uniforms.saturation.value = saturation
    renderer.setRenderTarget(null)
    quad.render(renderer)
  }
}
