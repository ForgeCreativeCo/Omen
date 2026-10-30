import { describe, expect, it } from 'vitest';

// Vite's glob keeps this free of Node typings.
const simSources = import.meta.glob<string>('../src/sim/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('architecture', () => {
  it('finds the sim sources', () => {
    expect(Object.keys(simSources).length).toBeGreaterThan(2);
  });

  it('sim/ never imports three.js, the DOM layers, or wall-clock randomness', () => {
    const offenders: string[] = [];
    for (const [file, src] of Object.entries(simSources)) {
      if (/from\s+['"]three/.test(src)) offenders.push(`${file}: imports three`);
      if (/from\s+['"]\.\.?\/.*(render|ui|debug)\//.test(src)) offenders.push(`${file}: imports render/ui/debug`);
      if (/Math\.random\s*\(/.test(src)) offenders.push(`${file}: uses Math.random`);
      if (/Date\.now\s*\(|performance\.now\s*\(/.test(src)) offenders.push(`${file}: reads wall-clock time`);
    }
    expect(offenders).toEqual([]);
  });
});
