import { expect, test } from 'vitest';
import { mount } from '@vue/test-utils';
import MapPlaceCard from '../src/components/MapPlaceCard.vue';

const place = { jibunAddr: '서울특별시 관악구 봉천동 1712', roadAddr: null };
const cand = (danjiId, name, match, extra = {}) => ({ danjiId, name, match, useAprDay: '2003-05-01', hhldCnt: 1000, dongCnt: 10, lastTrade: null, tradeCnt: 0, complexId: null, ...extra });

test('정확히 맞는 후보만 보이고, 등록 안 된 단지는 추가 / 등록된 단지는 보기', async () => {
  const candidates = [
    cand('A', '관악드림(삼성)', 'EXACT', { complexId: 7, lastTrade: { amountMan: 119300, dealDate: '2026-10-02', exclM2: 84.9 }, tradeCnt: 5 }),
    cand('B', '관악드림(동아)', 'EXACT'),
    cand('C', '두산', 'NEARBY'),
  ];
  const w = mount(MapPlaceCard, { props: { point: { x: 10, y: 10 }, place, candidates } });
  expect(w.text()).toContain('관악드림(삼성)');
  expect(w.text()).not.toContain('두산');
  expect(w.text()).toContain('11.93억');
  expect(w.text()).toContain('주변 필지 후보 1개');
  const btns = w.findAll('.act button');
  await btns[0].trigger('click');
  await btns[1].trigger('click');
  expect(w.emitted('open')[0]).toEqual([7]);
  expect(w.emitted('add')[0]).toEqual(['B']);
});

test('정확한 후보가 없으면 주변 필지, 후보가 없으면 직접 추가', async () => {
  const near = mount(MapPlaceCard, { props: { point: { x: 0, y: 0 }, place, candidates: [cand('C', '두산', 'NEARBY')] } });
  expect(near.text()).toContain('주변 필지');
  const none = mount(MapPlaceCard, { props: { point: { x: 0, y: 0 }, place, candidates: [] } });
  await none.find('.empty button').trigger('click');
  expect(none.emitted('add')[0]).toEqual([null]);
});
