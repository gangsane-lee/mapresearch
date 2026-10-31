/*
  region_code_map — 행정구역 개편 코드 대응 (계획서 §4.1, U15)
  인천(2026-07)·화성(2026-02) 개편의 신·구 코드와 적용 시점은 실제 API 조회로 확인한 뒤 채운다.
  확인 전에는 추측 값을 넣지 않는다 (CLAUDE.md 규칙).

  예시 형식:
  MERGE dbo.region_code_map AS t
  USING (VALUES ('NNNNN', NULL, 'OOOOO', '2026-07-01', NULL, N'메모')) AS s (lawd_cd, adm_cd, prev_lawd_cd, valid_from, valid_to, memo)
  ON t.lawd_cd = s.lawd_cd AND t.valid_from = s.valid_from
  WHEN NOT MATCHED THEN INSERT (...) VALUES (...);
*/
SELECT 1 AS region_code_map_pending;
