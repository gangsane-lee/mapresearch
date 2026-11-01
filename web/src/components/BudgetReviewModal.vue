<script setup>
// 매수 검토 — 설정의 예산(총 자금)으로 등록 단지마다 매매가 + 취득세·중개보수·기타 비용을 더해 살 수 있는지 본다.
// 세율·보수는 util/purchase.js 기준의 추정치 (1주택·일시적 2주택 가정). 조건은 이 화면에서만 바꾸고 저장하지 않는다.
import { computed, onMounted, ref } from 'vue';
import Modal from './Modal.vue';
import { api } from '../api/client.js';
import { STATUS, formatMan } from '../util/format.js';
import { reviewPurchase, maxPriceFor } from '../util/purchase.js';
import { useComplexesStore } from '../stores/complexes.js';

const emit = defineEmits(['close', 'select', 'open-settings']);
const store = useComplexesStore();

const budget = ref(null);
const error = ref(null);
const basis = ref('ASK'); // ASK: 호가(없으면 실거래) | TRADE: 최근 실거래 | LOWER: 둘 중 낮은 값
const vat = ref(true);
const etcPct = ref(0.2);

onMounted(async () => {
  try {
    const s = (await api('/api/settings')).items;
    const b = s.find((x) => x.key === 'budget_man')?.value;
    budget.value = b == null || b === '' ? null : Number(b);
  } catch (err) {
    error.value = err.message;
  }
});

function priceOf(c) {
  const ask = c.priceAsk;
  const trade = c.lastTrade?.amountMan ?? null;
  if (basis.value === 'TRADE') return trade != null ? { price: trade, src: '실거래' } : ask != null ? { price: ask, src: '호가' } : null;
  if (basis.value === 'LOWER' && ask != null && trade != null) return ask <= trade ? { price: ask, src: '호가' } : { price: trade, src: '실거래' };
  return ask != null ? { price: ask, src: '호가' } : trade != null ? { price: trade, src: '실거래' } : null;
}

const opts = computed(() => ({ vat: vat.value, etcPct: Number(etcPct.value) || 0 }));
const maxPrice = computed(() => maxPriceFor(budget.value, opts.value));

const rows = computed(() =>
  store.list
    .filter((c) => c.status !== 'EXCLUDED')
    .map((c) => {
      const p = priceOf(c);
      const suspicious = p && p.price < 1000; // 10억을 "10"으로 입력한 경우 등
      const r = p && !suspicious ? reviewPurchase({ price: p.price, exclM2: c.areaExclM2, budget: budget.value, ...opts.value }) : { verdict: 'NO_PRICE' };
      return { c, p, suspicious, r };
    })
    .toSorted((a, b) => (b.r.margin ?? -Infinity) - (a.r.margin ?? -Infinity)),
);
const count = (v) => rows.value.filter((x) => x.r.verdict === v).length;
const VERDICT = { OK: '가능', TIGHT: '빠듯', OVER: '초과', NO_PRICE: '가격 없음', NO_BUDGET: '-' };
const signed = (n) => (n == null ? '-' : `${n >= 0 ? '+' : '−'}${formatMan(Math.abs(n))}`);
</script>

<template>
  <Modal title="매수 검토 — 예산 대비" size="lg" resizable="budget" @close="emit('close')">
    <p v-if="error" class="err">{{ error }}</p>

    <section class="top">
      <div class="budget">
        <small>내 예산 (총 자금)</small>
        <b v-if="budget != null">{{ formatMan(budget) }}</b>
        <b v-else class="none">미설정</b>
        <button type="button" class="btn ghost" @click="emit('open-settings')">설정에서 변경</button>
      </div>
      <div class="max" :title="`취득세·중개보수${vat ? '(부가세 포함)' : ''}·기타 ${etcPct}% 를 더해도 예산 안인 최대 매매가`">
        <small>부대비용 포함 최대 매매가</small>
        <b>{{ maxPrice != null ? formatMan(maxPrice) : '-' }}</b>
      </div>
      <div class="counts">
        <span class="v OK">가능 {{ count('OK') }}</span>
        <span class="v TIGHT">빠듯 {{ count('TIGHT') }}</span>
        <span class="v OVER">초과 {{ count('OVER') }}</span>
        <span v-if="count('NO_PRICE')" class="v NO_PRICE">가격 없음 {{ count('NO_PRICE') }}</span>
      </div>
    </section>

    <section class="cond">
      <label>기준 가격
        <select v-model="basis">
          <option value="ASK">호가 (없으면 최근 실거래)</option>
          <option value="TRADE">최근 실거래 (없으면 호가)</option>
          <option value="LOWER">호가·실거래 중 낮은 값</option>
        </select>
      </label>
      <label class="chk"><input v-model="vat" type="checkbox" /> 중개보수 부가세 10% 포함</label>
      <label>기타 비용 <input v-model.number="etcPct" type="number" min="0" max="3" step="0.1" class="pct" />% <small>법무사·등기·채권 할인</small></label>
    </section>

    <table class="tbl">
      <thead>
        <tr><th>단지</th><th class="n">기준 가격</th><th class="n">취득세 등</th><th class="n">중개보수</th><th class="n">기타</th><th class="n">총 필요 자금</th><th class="n">예산 대비</th><th>판정</th></tr>
      </thead>
      <tbody>
        <tr v-for="{ c, p, suspicious, r } in rows" :key="c.complexId" @click="emit('select', c.complexId)">
          <td>
            <span class="dot" :style="{ background: STATUS[c.status]?.color }" />
            <b>{{ c.isFavorite ? '★ ' : '' }}{{ c.displayNm }}</b>
            <small>{{ c.areaLabel ?? '' }}{{ c.areaExclM2 ? ` · 전용 ${c.areaExclM2}㎡` : '' }}</small>
          </td>
          <td class="n">
            <template v-if="p">{{ formatMan(p.price) }} <small>{{ p.src }}</small></template>
            <template v-else>-</template>
            <small v-if="suspicious" class="err d">{{ p.price }}만원 — 입력 확인 (10억이면 "10억")</small>
          </td>
          <td class="n">{{ r.tax != null ? formatMan(r.tax) : '-' }} <small v-if="r.taxRate">{{ +r.taxRate.toFixed(2) }}%</small></td>
          <td class="n">{{ r.fee != null ? formatMan(r.fee) : '-' }}</td>
          <td class="n">{{ r.etc != null ? formatMan(r.etc) : '-' }}</td>
          <td class="n strong">{{ r.total != null ? formatMan(r.total) : '-' }}</td>
          <td class="n" :class="r.margin == null ? '' : r.margin >= 0 ? 'good' : 'bad'">{{ signed(r.margin) }}</td>
          <td><span class="v" :class="r.verdict">{{ VERDICT[r.verdict] }}</span></td>
        </tr>
      </tbody>
    </table>
    <p v-if="!rows.length" class="muted empty">등록한 단지가 없습니다.</p>
    <p class="note">
      추정치입니다. 취득세는 1주택·일시적 2주택(갈아타기) 기준 세율(6억 이하 1%, 9억 초과 3%, 그 사이 구간 비례 + 지방교육세, 전용 85㎡ 초과 농특세 0.2%)이며
      조정대상지역 다주택 중과는 반영하지 않습니다. 중개보수는 법정 상한 요율입니다. 대출 한도(LTV·DSR)는 예산에 이미 반영했다고 가정합니다.
      "빠듯"은 남는 돈이 예산의 5% 미만입니다. 행을 누르면 그 단지를 엽니다.
    </p>
  </Modal>
</template>

<style scoped>
.top { display: grid; grid-template-columns: 1fr 1fr 1.4fr; gap: 12px; margin-bottom: 12px; }
.top > div { border: 1px solid var(--line); border-radius: var(--radius); padding: 12px 14px; background: var(--surface-2); }
.top small { display: block; color: var(--muted); font-size: 12px; }
.top b { font-family: var(--serif); font-size: 26px; letter-spacing: -0.03em; }
.budget { background: var(--ink) !important; color: #fff; border-color: var(--ink) !important; }
.budget small { color: var(--champagne); }
.budget b.none { font-size: 18px; opacity: 0.7; }
.budget .btn { margin-top: 4px; padding: 2px 0; color: rgb(255 255 255 / 0.7); }
.counts { display: flex; flex-wrap: wrap; gap: 6px; align-content: center; }
.cond { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; font-size: 13px; color: var(--muted); margin-bottom: 10px; }
.cond label { display: flex; gap: 6px; align-items: center; }
.cond select, .cond input { padding: 4px 6px; border: 1px solid var(--line); border-radius: 6px; }
.cond .pct { width: 56px; }
.tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.tbl th { text-align: left; color: var(--muted); font-weight: 600; font-size: 12px; padding: 6px 8px; border-bottom: 1px solid var(--line-strong); white-space: nowrap; }
.tbl td { padding: 9px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.tbl tbody tr { cursor: pointer; }
.tbl tbody tr:hover { background: var(--surface-2); }
.tbl td small { color: var(--muted); font-size: 11.5px; margin-left: 4px; }
.tbl td small.d { display: block; margin: 2px 0 0; }
.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.strong { font-weight: 700; }
.good { color: var(--good); font-weight: 600; }
.bad { color: var(--up); font-weight: 600; }
.dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; vertical-align: 1px; }
.v { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 2px 9px; white-space: nowrap; }
.v.OK { background: var(--tint-good); color: var(--good); }
.v.TIGHT { background: var(--tint-warn); color: var(--warn); }
.v.OVER { background: var(--tint-bad); color: var(--up); }
.v.NO_PRICE, .v.NO_BUDGET { background: var(--surface-2); color: var(--muted); }
.note { margin: 14px 0 0; font-size: 12px; color: var(--muted); line-height: 1.6; }
.empty { padding: 20px 0; }
.err { color: var(--up); }
</style>
