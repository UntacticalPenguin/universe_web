// A smooth model disc, radius 15 kpc and exponential height 0.1 kpc (G3c).
// The display assumes one optical depth per kpc in the midplane. This is an
// illustrative opacity, independent of the measured Gaia extinction values.
export const modelDust = /* glsl */ `
  float verticalIntegral(float z) {
    return sign(z)*0.1*(1.-exp(-abs(z)/0.1));
  }
  float modelTransmission(vec3 eyePc, vec3 particlePc) {
    vec3 start=(eyePc-vec3(8200.,0.,-25.))*0.001;
    vec3 ray=(particlePc-eyePc)*0.001;
    float a=dot(ray.xy,ray.xy), b=dot(start.xy,ray.xy);
    float c=dot(start.xy,start.xy)-225.;
    float lo=0.,hi=1.;
    if(a>1e-10){
      float disc=b*b-a*c;
      if(disc<=0.) return 1.;
      float root=sqrt(disc);
      lo=max(lo,(-b-root)/a);
      hi=min(hi,(-b+root)/a);
    } else if(c>0.) return 1.;
    if(hi<=lo) return 1.;
    float z0=start.z+lo*ray.z, z1=start.z+hi*ray.z;
    float density=abs(z1-z0)<1e-4 ? exp(-abs(0.5*(z0+z1))/0.1)
      : (verticalIntegral(z1)-verticalIntegral(z0))/(z1-z0);
    return exp(-density*(hi-lo)*length(ray));
  }
`
