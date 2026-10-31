// 실거래 조회 (화면 경로 — 로컬 DB만). 수집은 P4 배치(jobs/monthlyTrade.js)에서 한다.
import { sql } from '../db/pool.js';
import { ymd, num } from '../db/tx.js';
import { matchAreaType } from '../util/trade.js';
import { getSettings } from './SettingService.js';

export async function listTrades(pool, complexId, { from } = {}) {
  const fromDate = from ?? (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 3);
    return ymd(d);
  })();
  const req = () => pool.request().input('c', sql.Int, complexId).input('f', sql.Date, fromDate);
  const areas = (
    await pool.request().input('c', sql.Int, complexId).query('SELECT area_type_id, label, excl_m2 FROM dbo.area_type WHERE complex_id = @c')
  ).recordset.map((a) => ({ areaTypeId: a.area_type_id, label: a.label, exclM2: Number(a.excl_m2) }));
  const tol = Number((await getSettings(pool, ['area_match_tolerance_m2'])).area_match_tolerance_m2 ?? 0.5);
  const area = (m2) => matchAreaType(Number(m2), areas, tol)?.areaTypeId ?? null;

  const sales = (
    await req().query(`SELECT trade_id, deal_date, excl_m2, floor, dong, amount_man, cancel_flag, cancel_date
                       FROM dbo.trade WHERE complex_id = @c AND deal_date >= @f ORDER BY deal_date DESC, trade_id DESC`)
  ).recordset.map((t) => ({
    tradeId: Number(t.trade_id),
    dealDate: ymd(t.deal_date),
    exclM2: num(t.excl_m2),
    areaTypeId: area(t.excl_m2),
    floor: t.floor,
    dong: t.dong,
    amountMan: t.amount_man,
    canceled: !!t.cancel_flag,
    cancelDate: ymd(t.cancel_date),
  }));

  const rents = (
    await req().query(`SELECT rent_id, deal_date, excl_m2, floor, deposit_man, monthly_man, contract_type
                       FROM dbo.trade_rent WHERE complex_id = @c AND deal_date >= @f ORDER BY deal_date DESC, rent_id DESC`)
  ).recordset.map((t) => ({
    rentId: Number(t.rent_id),
    dealDate: ymd(t.deal_date),
    exclM2: num(t.excl_m2),
    areaTypeId: area(t.excl_m2),
    floor: t.floor,
    depositMan: t.deposit_man,
    monthlyMan: t.monthly_man,
    contractType: t.contract_type,
  }));

  return { from: fromDate, areaTypes: areas, sales, rents };
}
