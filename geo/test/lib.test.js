import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitCityName, bboxOf, regionSeedSql } from '../lib.js';

test('splitCityName: 일반구는 상위 시 분리, 일반 구·군은 그대로', () => {
  assert.deepEqual(splitCityName('성남시분당구'), { cityNm: '성남시', sggNm: '성남시 분당구' });
  assert.deepEqual(splitCityName('수원시 영통구'), { cityNm: '수원시', sggNm: '수원시 영통구' });
  assert.deepEqual(splitCityName('관악구'), { cityNm: null, sggNm: '관악구' });
  assert.deepEqual(splitCityName('가평군'), { cityNm: null, sggNm: '가평군' });
  assert.deepEqual(splitCityName('과천시'), { cityNm: null, sggNm: '과천시' });
});

test('bboxOf: Polygon / MultiPolygon', () => {
  const poly = { type: 'Polygon', coordinates: [[[127, 37], [127.5, 37], [127.5, 37.5], [127, 37]]] };
  assert.deepEqual(bboxOf(poly), [127, 37, 127.5, 37.5]);
  const multi = { type: 'MultiPolygon', coordinates: [poly.coordinates, [[[126, 36], [126.1, 36], [126, 36.1], [126, 36]]]] };
  assert.deepEqual(bboxOf(multi), [126, 36, 127.5, 37.5]);
});

test('regionSeedSql: 작은따옴표 이스케이프, NULL 처리', () => {
  const sql = regionSeedSql([
    { code: '11620', sidoCd: '11', sidoNm: '서울특별시', sggNm: "관'악구", cityNm: null, bbox: [1, 2, 3, 4] },
  ]);
  assert.match(sql, /\('11620', '11', N'서울특별시', N'관''악구', NULL, 1, 2, 3, 4\)/);
});
