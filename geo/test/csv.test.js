import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeText, parseCsv, mapHeader } from '../../shared/csv.js';

test('parseCsv: 따옴표 안 쉼표·줄바꿈·이스케이프, CRLF, 빈 줄 무시', () => {
  const rows = parseCsv('a,b,c\r\n"x, y","say ""hi""","multi\nline"\r\n\r\n1,2,3');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'say "hi"', 'multi\nline'], ['1', '2', '3']]);
});

test('decodeText: UTF-8(BOM 제거) / EUC-KR 자동 판별', () => {
  assert.equal(decodeText(Buffer.from('﻿시도,구역명', 'utf8')), '시도,구역명');
  const eucKr = Buffer.from([0xbd, 0xc3, 0xb5, 0xb5]); // "시도" (EUC-KR)
  assert.equal(decodeText(eucKr), '시도');
});

test('mapHeader: 키워드 매핑, 한 헤더는 한 번만 사용', () => {
  const header = ['기준 연도', '시도', '시군구', '정비구역명칭', '추진 단계', '사업유형', '사업시행자', '건립세대수', '비고'];
  const { map, unmapped } = mapHeader(header, {
    sido_nm: ['시도'],
    sgg_nm: ['시군구'],
    zone_nm: ['구역명칭', '구역명'],
    stage: ['추진단계', '단계'],
    operator_nm: ['시행자'],
    supply_hhld: ['공급예정세대', '건립세대'],
  });
  assert.deepEqual(map, { sido_nm: 1, sgg_nm: 2, zone_nm: 3, stage: 4, operator_nm: 6, supply_hhld: 7 });
  assert.deepEqual(unmapped, ['기준 연도', '사업유형', '비고']);
});
