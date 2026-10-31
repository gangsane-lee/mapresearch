/*
  anchor / setting 초기값 (계획서 §3.3, §5.2.1)
  사용자가 설정 화면에서 바꾸는 값이므로 없을 때만 INSERT 한다(기존 값 덮어쓰기 금지).
  역 좌표는 참고용 근사값 — 설정 화면에서 지도 클릭으로 보정.
*/
MERGE dbo.anchor AS t
USING (VALUES
    (N'강남역',      'CBD',  37.497942, 127.027621, 10),
    (N'시청역',      'CBD',  37.565715, 126.977088, 20),
    (N'여의도역',    'CBD',  37.521747, 126.924015, 30),
    (N'내 직장',     'WORK', NULL,      NULL,       40),
    (N'배우자 직장', 'WORK', NULL,      NULL,       50)
) AS s (name, kind, lat, lng, sort)
ON t.name = s.name
WHEN NOT MATCHED THEN INSERT (name, kind, lat, lng, sort) VALUES (s.name, s.kind, s.lat, s.lng, s.sort);

MERGE dbo.setting AS t
USING (VALUES
    ('budget_man',                 NULL),        -- 내 예산(만원). 가계 연동 시 무시
    ('budget_source',              N'MANUAL'),   -- MANUAL | HH
    ('map_engine',                 N'NAVER'),    -- NAVER | KAKAO
    ('area_match_tolerance_m2',    N'0.5'),
    ('stale_days',                 N'30'),       -- 관측일 경과 시 흐림 표시
    ('quota.KAKAO_TRANSIT.DAY',    N'800'),
    ('quota.NCP_GEOCODE.DAY',      N'2000'),
    ('quota.NCP_GEOCODE.MONTH',    N'50000'),
    ('quota.DATA_GO_KR_KAPT.DAY',  N'4000'),     -- 개발계정 5,000/일의 80%
    ('quota.DATA_GO_KR_BLD.DAY',   N'4000'),     -- 한도 확인 전 보수적 기본값
    ('quota.DATA_GO_KR_RTMS.DAY',  N'8000'),     -- 개발계정 10,000/일의 80%
    ('quota.DATA_GO_KR_RENT.DAY',  N'4000'),     -- 한도 확인 전 보수적 기본값
    ('quota_warn_ratio',           N'0.7'),
    ('flag_gap_pct',               N'-5'),       -- A3 호가 괴리 강조 기준(%)
    ('weight.traffic',             N'3'),        -- A2 가중치 종합점수
    ('weight.env',                 N'2'),
    ('weight.edu',                 N'2'),
    ('weight.price',               N'3')
) AS s (setting_key, setting_val)
ON t.setting_key = s.setting_key
WHEN NOT MATCHED THEN INSERT (setting_key, setting_val) VALUES (s.setting_key, s.setting_val);
