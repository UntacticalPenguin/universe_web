import * as THREE from "three"
import { createColourLut, temperatureOf } from "../stars/colour-lut"
import { fluxOf, luminanceWeights } from "../render/light"
import type { Hierarchy, Tile } from "./hierarchy"

// A payload contains disjoint stars. Each child's sum includes all its descendants.
export function unresolvedLight(total: number, children: number, weight: number, refined: boolean) {
  return Math.max(0, total - children) * (1 - weight) + (refined ? 0 : children)
}

export function createGlowLayer(tree: Hierarchy, scene: THREE.Scene) {
  const quad = new THREE.PlaneGeometry(2, 2)
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.index = quad.index
  geometry.setAttribute("position", quad.attributes.position)
  const size = Object.keys(tree.nodes).length + 1
  const centers = new THREE.InstancedBufferAttribute(new Float32Array(size * 3), 3).setUsage(THREE.DynamicDrawUsage)
  const data = new THREE.InstancedBufferAttribute(new Float32Array(size * 3), 3).setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute("offsetPc", centers)
  geometry.setAttribute("properties", data)
  const { uniforms, material } = createGaussianMaterial()
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  scene.add(mesh)
  let count = 0
  return {
    add(node: Tile, light: number, camera: THREE.Camera, dust: boolean) {
      if (light <= 0) return
      const [x, y, z] = node.centroid
      centers.setXYZ(count, x - camera.position.x, y - camera.position.y, z - camera.position.z)
      data.setXYZ(count++, node.half, light, dust ? temperatureOf(node.meanBpRp) : 10 ** node.meanLogTeff0)
    },
    finish(focal: number) {
      uniforms.focal.value = focal
      geometry.instanceCount = count
      mesh.visible = count > 0
      for (const attribute of [centers, data]) {
        attribute.clearUpdateRanges()
        if (count) attribute.addUpdateRange(0, count * 3)
        attribute.needsUpdate = true
      }
      count = 0
    },
  }
}

export function createGaussianMaterial() {
  const uniforms = { focal: { value: 1 }, observer: { value: new THREE.Vector3() }, strength: { value: 1 }, lut: { value: createColourLut() } }
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec3 offsetPc, properties;
      uniform float focal, strength;
      uniform vec3 observer;
      uniform sampler2D lut;
      varying vec2 coord;
      varying vec3 intensity;
      void main(){
        vec3 view = mat3(viewMatrix)*(offsetPc-observer);
        float depth = max(-view.z, 0.000001);
        float sigma = max(2., focal*properties.x*0.5/depth);
        coord = position.xy * 3.;
        float flux = strength*properties.y * ${fluxOf(4.83) * 100} / max(dot(view,view),1e-12);
        vec3 rgb = texture2D(lut,vec2((clamp(log(properties.z/2000.)/log(25.),0.,1.)*255.+0.5)/256.,0.5)).rgb;
        intensity = rgb / dot(rgb,vec3(${luminanceWeights.join(",")})) * flux / (6.2831853*sigma*sigma*(1.-exp(-4.5)));
        view.xy += coord*sigma*depth/focal;
        gl_Position = projectionMatrix*vec4(view,1.);
      }`,
    fragmentShader: `varying vec2 coord; varying vec3 intensity;
      void main(){float r2=dot(coord,coord); if(r2>9.)discard; gl_FragColor=vec4(intensity*exp(-0.5*r2),1.);}`,
  })
  return { material, uniforms }
}
