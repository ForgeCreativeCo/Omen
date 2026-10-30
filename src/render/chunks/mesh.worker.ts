import { meshVoxels, type ColumnVoxels, type MeshData } from './mesher';

export interface MeshRequest {
  key: number;
  version: number;
  column: ColumnVoxels;
}

export interface MeshResponse {
  key: number;
  version: number;
  opaque: MeshData | null;
  water: MeshData | null;
}

const transferables = (m: MeshData | null): ArrayBuffer[] =>
  m ? [m.positions, m.normals, m.colors, m.tint, m.indices].map((a) => a.buffer as ArrayBuffer) : [];

self.onmessage = (e: MessageEvent<MeshRequest>) => {
  const { key, version, column } = e.data;
  const { opaque, water } = meshVoxels(column);
  const res: MeshResponse = { key, version, opaque, water };
  self.postMessage(res, { transfer: [...transferables(opaque), ...transferables(water)] });
};
