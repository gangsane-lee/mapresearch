import { describe, expect, test } from 'vitest';
import { buildMaskPaths, signedArea, mergeGeometries, pointInGeometry, inBbox, KOREA_OUTER } from '../src/map/mask.js';

const square = (x, y, s = 1) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]; // 반시계, 닫힌 링

describe('buildMaskPaths', () => {
  test('바깥은 시계방향, 구멍은 반시계방향, 닫는 점 제거', () => {
    const [outer, hole] = buildMaskPaths({ type: 'Polygon', coordinates: [square(127, 37)] });
    expect(signedArea(outer)).toBeLessThan(0);
    expect(signedArea(hole)).toBeGreaterThan(0);
    expect(hole).toHaveLength(4);
    expect(outer).toHaveLength(KOREA_OUTER.length);
  });

  test('시계방향 입력도 반시계 구멍으로 뒤집음', () => {
    const cw = square(127, 37).slice().reverse();
    const [, hole] = buildMaskPaths({ type: 'Polygon', coordinates: [cw] });
    expect(signedArea(hole)).toBeGreaterThan(0);
  });

  test('다중 조각 구는 조각마다 구멍, 내부 enclave는 무시', () => {
    const geom = {
      type: 'MultiPolygon',
      coordinates: [[square(127, 37, 2), square(127.5, 37.5, 0.2)], [square(126, 36)]],
    };
    expect(buildMaskPaths(geom)).toHaveLength(3); // outer + 조각 2개
  });
});

describe('pointInGeometry / inBbox', () => {
  const g = { type: 'Polygon', coordinates: [square(127, 37, 2), square(127.5, 37.5, 0.5)] };
  test('내부·외부·구멍', () => {
    expect(pointInGeometry([127.2, 37.2], g)).toBe(true);
    expect(pointInGeometry([129, 37.2], g)).toBe(false);
    expect(pointInGeometry([127.7, 37.7], g)).toBe(false); // 구멍 안
  });
  test('mergeGeometries 후에도 판정', () => {
    const m = mergeGeometries([g, { type: 'Polygon', coordinates: [square(130, 37)] }]);
    expect(pointInGeometry([130.5, 37.5], m)).toBe(true);
  });
  test('inBbox', () => {
    expect(inBbox([127, 37], [126, 36, 128, 38])).toBe(true);
    expect(inBbox([129, 37], [126, 36, 128, 38])).toBe(false);
  });
});
