import * as THREE from "three"
import { createColourLut, temperatureOf } from "../stars/colour-lut"
import type { Hierarchy } from "./hierarchy"
export function createGlowLayer(tree: Hierarchy, scene: THREE.Scene) {
  const capacity = Object.keys(tree.nodes).length
  const position = new THREE.Float32BufferAttribute(new Float32Array(3 * capacity), 3)
  const emission = new THREE.Float32BufferAttribute(new Float32Array(3 * capacity), 3)
  const geometry = new THREE.BufferGeometry().setAttribute("position", position).setAttribute("emission", emission)
  const material = new THREE.ShaderMaterial({
    uniforms: { lut: { value: createColourLut() } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec3 emission; uniform sampler2D lut; varying vec3 light;
    void main(){vec4 view=modelViewMatrix*vec4(position,1.);float d=max(1.,length(view.xyz));
    gl_Position=projectionMatrix*view;gl_PointSize=clamp(1000.*emission.z/d,4.,64.);
    vec3 rgb=texture2D(lut,vec2(emission.y,0.5)).rgb;
    light=rgb/max(dot(rgb,vec3(.2126,.7152,.0722)),.001)*emission.x*294./(d*d*.193*gl_PointSize*gl_PointSize);}`,
    fragmentShader: `varying vec3 light;void main(){vec2 p=2.*gl_PointCoord-1.;float r=dot(p,p);if(r>1.)discard;gl_FragColor=vec4(light*exp(-4.*r),1.);}`,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  scene.add(points)
  return {
    update(ids: string[], dust: boolean) {
      ids.forEach((id, i) => {
        const n = tree.nodes[id]
        position.setXYZ(i, ...n.centroid)
        emission.setXYZ(i, dust ? n.lSum : n.lSum0, Math.log((dust ? temperatureOf(n.meanBpRp) : 10 ** n.meanLogTeff0) / 2000) / Math.log(25), n.half)
      })
      geometry.setDrawRange(0, ids.length)
      position.needsUpdate = true
      emission.needsUpdate = true
    },
  }
}
