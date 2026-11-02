import * as THREE from 'three';
import { TUNING } from '../../sim/tuning';

/**
 * Shared uniforms for all terrain/water materials, driven each frame by the
 * lighting/season controller. Patching Lambert keeps three's lights and shadows.
 */
export const terrainUniforms = {
  uSeasonTint: { value: new THREE.Color(1, 1, 1) },
  /** 0..1, how far foliage desaturates (winter). */
  uSeasonDesat: { value: 0 },
  /** 0..1, how far deciduous trees have turned to autumn colours. */
  uAutumn: { value: 0 },
  /** 0..1, how far their leaves have died back to winter brown. */
  uBare: { value: 0 },
  /** 0..1, how much of the island lies under snow. */
  uSnow: { value: 0 },
  uSeaY: { value: TUNING.terrain.seaLevel },
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
       attribute vec3 aSeason;
       varying vec3 vSeason;
       varying vec3 vWN;
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
       vUpness = (modelMatrix * vec4(objectNormal, 0.0)).y;
       vSeason = aSeason;
       vWN = (modelMatrix * vec4(objectNormal, 0.0)).xyz;`,
    );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    `#include <common>
     uniform vec3 uFadeColor;
     uniform float uFadeLow;
     uniform float uFadeHigh;
     uniform float uTime;
     uniform vec4 uWet[4];
     uniform float uAutumn;
     uniform float uBare;
     uniform float uSnow;
     uniform float uSeaY;
     varying vec3 vWorld;
     varying float vUpness;
     varying vec3 vSeason;
     varying vec3 vWN;
     float seasonHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`,
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
         float snowCover = 0.0;
         {
           // The voxel this face belongs to: step back inside along the normal.
           vec3 cell = floor(vWorld - vWN * 0.5);
           float ao = vSeason.z;
           if (vSeason.x > 0.0) {
             // Trees turn one by one, each to its own colour, then brown and bare.
             vec2 tree = floor(cell.xz / 4.0);
             float h = seasonHash(tree);
             float hue = seasonHash(tree + 31.7);
             vec3 fall = hue < 0.4 ? vec3(0.62, 0.42, 0.03) : hue < 0.75 ? vec3(0.66, 0.2, 0.02) : vec3(0.5, 0.05, 0.03);
             fall *= ao * (0.85 + 0.3 * seasonHash(cell.xz + cell.y * 7.1));
             float turn = smoothstep(h * 0.55, h * 0.55 + 0.45, uAutumn);
             float dead = smoothstep(h * 0.4, h * 0.4 + 0.6, uBare);
             diffuseColor.rgb = mix(diffuseColor.rgb, fall, turn * vSeason.x);
             diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.15, 0.11, 0.075) * ao, dead * vSeason.x);
           }
           if (uSnow > 0.0) {
             // Snow settles on tops, voxel by voxel; the shore holds less of it.
             float up = smoothstep(0.6, 0.95, vWN.y);
             float low = mix(0.5, 1.0, smoothstep(uSeaY + 2.0, uSeaY + 6.0, cell.y));
             float n = seasonHash(cell.xz * 1.37 + cell.y);
             snowCover = smoothstep(n - 0.1, n + 0.1, uSnow * low * 1.2) * up * vSeason.y;
             diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.98) * ao, snowCover);
           }
         }
         {
           // Ground under a rain cloud darkens, and dries again slowly.
           float wet = 0.0;
           for (int i = 0; i < 4; i++) {
             vec4 w = uWet[i];
             float d = length(vWorld.xz - w.xy);
             wet = max(wet, w.w * (1.0 - smoothstep(w.z * 0.6, w.z, d)));
           }
           diffuseColor.rgb *= 1.0 - 0.38 * wet * (1.0 - snowCover);
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
