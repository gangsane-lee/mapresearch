/*
  region_code_map — 행정구역 개편 코드 대응 (계획서 §4.1, U15)
  신·구 코드는 실제 API 조회로 확인한 것만 넣는다 (추측 값 금지, CLAUDE.md 규칙).

  화성시(41590) → 만세구 41591 · 효행구 41593 · 병점구 41595 · 동탄구 41597 (2026-02 개편)
    2026-11-01 국토부 실거래 API 실호출 확인: 41590 은 2025-12~2026-11 전부 0건,
    새 코드는 개편 전 달(2025-12, 41597 731건)까지 새 코드로 조회된다 → 실거래는 새 코드로만 받는다.
    단지 식별정보(kapt_ref, 2026-08-31 파일)와 등록 단지는 옛 코드(41590·4159013000 등)를 그대로 쓴다.
  인천(2026-07) 개편은 아직 실호출로 확인하지 않아 넣지 않는다.
*/
MERGE dbo.region_code_map AS t
USING (VALUES
    ('41591', NULL, '41590', '2026-02-01', NULL, N'화성시 만세구 (실거래 API 확인 2026-11-01)'),
    ('41593', NULL, '41590', '2026-02-01', NULL, N'화성시 효행구 (실거래 API 확인 2026-11-01)'),
    ('41595', NULL, '41590', '2026-02-01', NULL, N'화성시 병점구 (실거래 API 확인 2026-11-01)'),
    ('41597', NULL, '41590', '2026-02-01', NULL, N'화성시 동탄구 (실거래 API 확인 2026-11-01)')
) AS s (lawd_cd, adm_cd, prev_lawd_cd, valid_from, valid_to, memo)
ON t.lawd_cd = s.lawd_cd AND t.valid_from = s.valid_from
WHEN MATCHED THEN UPDATE SET prev_lawd_cd = s.prev_lawd_cd, valid_to = s.valid_to, memo = s.memo
WHEN NOT MATCHED THEN INSERT (lawd_cd, adm_cd, prev_lawd_cd, valid_from, valid_to, memo)
    VALUES (s.lawd_cd, s.adm_cd, s.prev_lawd_cd, s.valid_from, s.valid_to, s.memo);
