// 마스터(불변 정보) 리비전 반영/무시 (계획서 §6)
//   반영: 기존 CURRENT → SUPERSEDED, PENDING → CURRENT
//   무시: PENDING → REJECTED (같은 hash는 다시 묻지 않음 — 재검증 배치가 REJECTED hash를 건너뛴다)
import { sql } from '../db/pool.js';
import { withTransaction, ymd } from '../db/tx.js';
import { AppError } from '../util/errors.js';

async function requirePending(req, revId) {
  const r = await req().input('r', sql.Int, revId).query('SELECT rev_id, complex_id, status FROM dbo.master_revision WITH (UPDLOCK) WHERE rev_id = @r');
  const row = r.recordset[0];
  if (!row) throw new AppError('NOT_FOUND', '리비전을 찾을 수 없습니다', 404);
  if (row.status !== 'PENDING') throw new AppError('CONFLICT', `대기 중인 리비전이 아닙니다 (${row.status})`, 409);
  return row;
}

export async function acceptRevision(pool, revId) {
  return withTransaction(pool, async (_tx, req) => {
    const rev = await requirePending(req, revId);
    await req()
      .input('c', sql.Int, rev.complex_id)
      .query("UPDATE dbo.master_revision SET status = 'SUPERSEDED', decided_at = SYSDATETIME() WHERE complex_id = @c AND status = 'CURRENT'");
    await req().input('r', sql.Int, revId).query("UPDATE dbo.master_revision SET status = 'CURRENT', decided_at = SYSDATETIME() WHERE rev_id = @r");
    return { revId, status: 'CURRENT' };
  });
}

export async function rejectRevision(pool, revId) {
  return withTransaction(pool, async (_tx, req) => {
    await requirePending(req, revId);
    await req().input('r', sql.Int, revId).query("UPDATE dbo.master_revision SET status = 'REJECTED', decided_at = SYSDATETIME() WHERE rev_id = @r");
    return { revId, status: 'REJECTED' };
  });
}

/** 현재 값과 대기 리비전의 필드별 차이 (변경 감지 배너 표) */
export async function revisionDiff(pool, complexId) {
  const rows = (
    await pool
      .request()
      .input('c', sql.Int, complexId)
      .query(`SELECT rev_id, status, use_apr_day, hhld_cnt, dong_cnt, max_floor, builder, heat_type, hall_type,
                     far_ratio, bc_ratio, plat_area, park_cnt
              FROM dbo.master_revision WHERE complex_id = @c AND status IN ('CURRENT','PENDING')`)
  ).recordset;
  const cur = rows.find((r) => r.status === 'CURRENT');
  const pen = rows.find((r) => r.status === 'PENDING');
  if (!pen) return { pendingRevId: null, changes: [] };
  const LABELS = {
    use_apr_day: '사용승인일',
    hhld_cnt: '세대수',
    dong_cnt: '동 수',
    max_floor: '최고층',
    builder: '시공사',
    heat_type: '난방',
    hall_type: '복도유형',
    far_ratio: '용적률',
    bc_ratio: '건폐율',
    plat_area: '대지면적',
    park_cnt: '주차대수',
  };
  const norm = (v) => (v == null ? null : v instanceof Date ? ymd(v) : String(Number.isNaN(Number(v)) ? v : Number(v)));
  const changes = Object.entries(LABELS)
    .filter(([k]) => norm(cur?.[k]) !== norm(pen[k]))
    .map(([k, label]) => ({ field: k, label, current: norm(cur?.[k]), pending: norm(pen[k]) }));
  return { pendingRevId: pen.rev_id, changes };
}
