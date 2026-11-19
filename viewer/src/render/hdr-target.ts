import * as THREE from "three"

export function createHdrTarget(width: number, height: number, type: THREE.TextureDataType = THREE.HalfFloatType) {
  return new THREE.WebGLRenderTarget(width, height, {
    type,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  })
}
