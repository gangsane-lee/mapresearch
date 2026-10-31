// ECharts option 생성 (순수 함수 — 테스트 대상). 금액은 만원 → 억 표시.
const eok = (man) => (man == null ? null : Math.round((man / 10000) * 100) / 100);
const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];

const baseGrid = { left: 56, right: 56, top: 40, bottom: 56 };
// 눈금은 최소 1개월 간격 (짧은 기간에서 같은 월 라벨이 겹치지 않도록)
const timeAxis = { type: 'time', minInterval: 28 * 24 * 3600 * 1000, axisLabel: { formatter: '{yy}.{MM}', hideOverlap: true } };
const tooltip = { trigger: 'axis' };

/** 월별 평균 (yyyy-MM → 평균) */
export function monthlyAvg(rows, dateKey, valueKey) {
  const m = new Map();
  for (const r of rows) {
    const k = r[dateKey].slice(0, 7);
    const v = m.get(k) ?? { sum: 0, n: 0 };
    v.sum += r[valueKey];
    v.n += 1;
    m.set(k, v);
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({ month: k, value: v.sum / v.n }));
}

/**
 * 시세 추이 (계획서 §7.3 2번): 내 호가(라인) + 매매 실거래(산점도) + 전세(라인) + 전세가율(보조축)
 * @param {{ ask: Array<{observedAt,value}>, sales: Array, rents: Array }} d  sales/rents 는 선택 평형으로 이미 거른 값
 */
export function priceTrendOption({ ask, sales, rents }) {
  const okSales = sales.filter((s) => !s.canceled);
  const jeonse = rents.filter((r) => !r.monthlyMan);
  const saleAvg = new Map(monthlyAvg(okSales, 'dealDate', 'amountMan').map((x) => [x.month, x.value]));
  const jeonseAvg = monthlyAvg(jeonse, 'dealDate', 'depositMan');
  const ratio = jeonseAvg
    .filter((j) => saleAvg.has(j.month))
    .map((j) => [`${j.month}-15`, Math.round((j.value / saleAvg.get(j.month)) * 1000) / 10]);

  return {
    color: PALETTE,
    tooltip,
    legend: { top: 0 },
    grid: baseGrid,
    xAxis: timeAxis,
    yAxis: [
      { type: 'value', name: '억', scale: true },
      { type: 'value', name: '전세가율 %', min: 0, max: 100, splitLine: { show: false } },
    ],
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8 }],
    series: [
      { name: '내 호가', type: 'line', step: 'end', symbolSize: 7, data: ask.map((a) => [a.observedAt, eok(a.value)]) },
      { name: '매매 실거래', type: 'scatter', symbolSize: 6, data: okSales.map((s) => [s.dealDate, eok(s.amountMan), s.floor]) },
      { name: '전세(월평균)', type: 'line', smooth: true, symbol: 'none', data: jeonseAvg.map((j) => [`${j.month}-15`, eok(j.value)]) },
      { name: '전세가율', type: 'line', yAxisIndex: 1, symbol: 'none', lineStyle: { type: 'dashed' }, data: ratio },
    ],
  };
}

/** 여러 계열 라인 (단지 비교 겹침, 소요시간 추이 등) */
export function multiLineOption(series, { unit = '', valueFmt = (v) => v, step = false } = {}) {
  return {
    color: PALETTE,
    tooltip,
    legend: { top: 0 },
    grid: baseGrid,
    xAxis: timeAxis,
    yAxis: { type: 'value', name: unit, scale: true },
    series: series.map((s) => ({
      name: s.name,
      type: 'line',
      step: step ? 'end' : false,
      symbolSize: 7,
      data: s.points.map((p) => [p.observedAt, valueFmt(p.value)]),
    })),
  };
}

/** 등급 추이 — S=4 … C=1 계단형 */
export function gradeTrendOption(series, enums) {
  const labels = new Map(enums.filter((e) => e.fieldCd.startsWith('grade_')).map((e) => [e.ord, e.code]));
  const opt = multiLineOption(series, { step: true });
  opt.yAxis = { type: 'value', min: 1, max: 4, interval: 1, axisLabel: { formatter: (v) => labels.get(v) ?? '' } };
  return opt;
}

/** 기준일 바 차트 */
export function barOption(categories, values, { unit = '', valueFmt = (v) => v } = {}) {
  return {
    color: PALETTE,
    tooltip: { trigger: 'axis' },
    grid: { ...baseGrid, bottom: 32 },
    xAxis: { type: 'category', data: categories },
    yAxis: { type: 'value', name: unit }, // 막대는 0 기준 (scale 쓰면 차이가 과장됨)
    series: [{ type: 'bar', barMaxWidth: 48, label: { show: true, position: 'top' }, data: values.map((v) => (v == null ? null : valueFmt(v))) }],
  };
}

/** 등급 레이더 (교통·환경·학군) */
export function radarOption(items, indicators) {
  return {
    color: PALETTE,
    tooltip: {},
    legend: { top: 0 },
    radar: { indicator: indicators.map((n) => ({ name: n, max: 4, min: 0 })), radius: '65%' },
    series: [{ type: 'radar', data: items.map((i) => ({ name: i.name, value: i.values.map((v) => v ?? 0) })) }],
  };
}

export { eok };
