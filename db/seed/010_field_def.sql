/*
  field_def / enum_def — 첨부 임장 보고서 항목 (계획서 §3.2, §3.4, §6)
  seed가 메타데이터의 기준이므로 MATCHED 시 갱신한다.
  sort는 입력 폼 순서: 교통 → 환경 → 학군 → 가격 → 정비 → 결론
*/
MERGE dbo.field_def AS t
USING (VALUES
 -- field_cd,              label,              category,  type,   unit,   scope,     diff,   better, carry, confirm, sort
 ('trn_station',           N'최근접 역',        'TRAFFIC', 'text', NULL,   'COMPLEX', 'NONE', 'NONE', 1, 0, 110),
 ('trn_station_walk_min',  N'역 도보시간',      'TRAFFIC', 'num',  N'분',  'COMPLEX', 'ABS',  'DOWN', 1, 0, 120),
 ('grade_traffic',         N'교통 등급',        'TRAFFIC', 'enum', NULL,   'COMPLEX', 'NONE', 'UP',   1, 1, 130),
 ('note_traffic',          N'교통 결론',        'TRAFFIC', 'text', NULL,   'COMPLEX', 'NONE', 'NONE', 1, 0, 140),
 ('env_hazard',            N'유해시설(반경 3km)', 'ENV',   'bool', NULL,   'COMPLEX', 'NONE', 'NONE', 1, 0, 210),
 ('env_hazard_memo',       N'유해시설 메모',    'ENV',     'text', NULL,   'COMPLEX', 'NONE', 'NONE', 1, 0, 220),
 ('env_dept',              N'백화점',           'ENV',     'num',  N'개',  'COMPLEX', 'ABS',  'UP',   1, 0, 230),
 ('env_mart',              N'대형마트',         'ENV',     'num',  N'개',  'COMPLEX', 'ABS',  'UP',   1, 0, 240),
 ('env_hospital',          N'종합병원',         'ENV',     'num',  N'개',  'COMPLEX', 'ABS',  'UP',   1, 0, 250),
 ('grade_env',             N'환경 등급',        'ENV',     'enum', NULL,   'COMPLEX', 'NONE', 'UP',   1, 1, 260),
 ('note_env',              N'환경 결론',        'ENV',     'text', NULL,   'COMPLEX', 'NONE', 'NONE', 1, 0, 270),
 ('edu_academy_cnt',       N'학원가 수',        'EDU',     'num',  N'개',  'COMPLEX', 'ABS',  'UP',   1, 0, 310),
 ('grade_edu',             N'학군 등급',        'EDU',     'enum', NULL,   'COMPLEX', 'NONE', 'UP',   1, 1, 320),
 ('note_edu',              N'학군 결론',        'EDU',     'text', NULL,   'COMPLEX', 'NONE', 'NONE', 1, 0, 330),
 ('price_ask',             N'현재 호가',        'PRICE',   'num',  N'만원', 'AREA',   'BOTH', 'DOWN', 1, 1, 410),
 ('price_last_trade',      N'최근 실거래',      'PRICE',   'num',  N'만원', 'AREA',   'BOTH', 'NONE', 0, 0, 420),
 ('price_last_trade_ym',   N'최근 실거래 월',   'PRICE',   'date', NULL,   'AREA',    'NONE', 'NONE', 0, 0, 430),
 ('redev_stage',           N'정비사업 단계',    'REDEV',   'enum', NULL,   'COMPLEX', 'NONE', 'NONE', 1, 0, 510),
 ('note_overall',          N'종합 및 느낀점',   'NOTE',    'text', NULL,   'COMPLEX', 'NONE', 'NONE', 0, 0, 610)
) AS s (field_cd, label, category, data_type, unit, scope, diff_mode, better, carry_forward, confirm_on_carry, sort)
ON t.field_cd = s.field_cd
WHEN MATCHED THEN UPDATE SET
    label = s.label, category = s.category, data_type = s.data_type, unit = s.unit, scope = s.scope,
    diff_mode = s.diff_mode, better = s.better, carry_forward = s.carry_forward,
    confirm_on_carry = s.confirm_on_carry, sort = s.sort
WHEN NOT MATCHED THEN INSERT (field_cd, label, category, data_type, unit, scope, diff_mode, better, carry_forward, confirm_on_carry, sort)
    VALUES (s.field_cd, s.label, s.category, s.data_type, s.unit, s.scope, s.diff_mode, s.better, s.carry_forward, s.confirm_on_carry, s.sort);

MERGE dbo.enum_def AS t
USING (
    SELECT f.field_cd, g.code, g.label, g.ord
    FROM (VALUES ('grade_traffic'), ('grade_env'), ('grade_edu')) AS f (field_cd)
    CROSS JOIN (VALUES ('S', N'최상', 4), ('A', N'좋음', 3), ('B', N'보통', 2), ('C', N'미흡', 1)) AS g (code, label, ord)
    UNION ALL
    SELECT 'redev_stage', code, label, ord
    FROM (VALUES
        ('NONE',             N'해당없음',     0),
        ('PREP',             N'추진준비',     1),
        ('SAFETY',           N'안전진단',     2),
        ('ZONE',             N'정비구역지정', 3),
        ('COMMITTEE',        N'추진위',       4),
        ('UNION',            N'조합설립',     5),
        ('PROJECT_APPROVAL', N'사업시행인가', 6),
        ('MGMT_APPROVAL',    N'관리처분인가', 7),
        ('RELOCATION',       N'이주·철거',    8),
        ('CONSTRUCTION',     N'착공',         9),
        ('COMPLETED',        N'준공',         10)
    ) AS r (code, label, ord)
) AS s
ON t.field_cd = s.field_cd AND t.code = s.code
WHEN MATCHED THEN UPDATE SET label = s.label, ord = s.ord
WHEN NOT MATCHED THEN INSERT (field_cd, code, label, ord) VALUES (s.field_cd, s.code, s.label, s.ord);
