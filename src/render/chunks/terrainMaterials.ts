import * as THREE from 'three';

/**
 * Shared uniforms for all terrain/water materials, driven each frame by the
 * lighting/season controller. Patching Lambert keeps three's lights and shadows.
 */
export const terrainUniforms = {
  uSeasonTint: { value: new THREE.Color(1, 1, 1) },
  /** 0..1, how far foliage desaturates (winter). */
  uSeasonDesat: { value: 0 },
  /** Color the underside fades into, below uFadeHigh. */
  uFadeColor: { value: new THREE.Color(0xa9cfe6) },
  uFadeLow: { value: -38 },
  uFadeHigh: { value: -12 },
  uTime: { value: 0 },
  /** Up to four wet patches (scene x, z, radius, strength) darkening the ground under rain. */
  uWet: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0)) },
};

function patchCommon(shader: THREE.WebGLProgramParametersWithUniforms): void {
  Object.assign(shader.uniforms, terrainUniforms);
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
       attribute float aTint;
       uniform vec3 uSeasonTint;
       uniform float uSeasonDesat;
       varying vec3 vWorld;
       varying float vUpness;`,
    )
    .replace(
      '#include <color_vertex>',
      `#include <color_vertex>
       {
         vec3 tinted = vColor.rgb * uSeasonTint;
         float lum = dot(tinted, vec3(0.299, 0.587, 0.114));
         tinted = mix(tinted, vec3(lum), uSeasonDesat);
         vColor.rgb = mix(vColor.rgb, tinted, clamp(aTint, 0.0, 1.0));
       }`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
       vUpness = (modelMatrix * vec4(objectNormal, 0.0)).y;`,
    );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    `#include <common>
     uniform vec3 uFadeColor;
     uniform float uFadeLow;
     uniform float uFadeHigh;
     uniform float uTime;
     uniform vec4 uWet[4];
     varying vec3 vWorld;
     varying float vUpness;`,
  );
}

const fade = `
  gl_FragColor.rgb = mix(uFadeColor, gl_FragColor.rgb, smoothstep(uFadeLow, uFadeHigh, vWorld.y));`;

export function createTerrainMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    patchCommon(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         {
           // Ground under a rain cloud darkens, and dries again slowly.
           float wet = 0.0;
           for (int i = 0; i < 4; i++) {
             vec4 w = uWet[i];
             float d = length(vWorld.xz - w.xy);
             wet = max(wet, w.w * (1.0 - smoothstep(w.z * 0.6, w.z, d)));
           }
           diffuseColor.rgb *= 1.0 - 0.38 * wet;
         }`,
      )
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>${fade}`);
  };
  mat.customProgramCacheKey = () => 'omen-terrain';
  return mat;
}

export function createWaterMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  });
  mat.onBeforeCompile = (shader) => {
    patchCommon(shader);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `{
         // Soft moving glints on the surface; sides stay calm.
         float up = step(0.5, vUpness);
         float w = sin(vWorld.x * 0.35 + uTime * 0.9) * sin(vWorld.z * 0.3 - uTime * 0.7)
                 + 0.4 * sin((vWorld.x - vWorld.z) * 0.6 + uTime * 1.4);
         outgoingLight *= 1.0 + up * 0.07 * w;
       }
       #include <opaque_fragment>${fade}`,
    );
  };
  mat.customProgramCacheKey = () => 'omen-water';
  return mat;
}
