/*
  001_init — AptLog 초기 스키마 (계획서 §4)
  - 금액: 만원 정수(int). 일시: KST 로컬 datetime2. 관측일: date.
  - snapshot / snapshot_value / snapshot_void / commute 는 append-only (권한은 002_app_role).
*/

-- ── 지역 ────────────────────────────────────────────────
CREATE TABLE dbo.region (
    sigungu_cd   char(5)       NOT NULL CONSTRAINT PK_region PRIMARY KEY,   -- 법정동 기준 시군구 (LAWD_CD)
    sido_cd      char(2)       NOT NULL,
    sido_nm      nvarchar(20)  NOT NULL,
    sgg_nm       nvarchar(30)  NOT NULL,
    city_nm      nvarchar(20)  NULL,                                         -- 일반구의 상위 시 (예: 성남시)
    min_lng      decimal(9,6)  NULL,
    min_lat      decimal(9,6)  NULL,
    max_lng      decimal(9,6)  NULL,
    max_lat      decimal(9,6)  NULL,
    valid_from   date          NULL,
    valid_to     date          NULL
);

CREATE TABLE dbo.region_code_map (
    map_id       int IDENTITY  NOT NULL CONSTRAINT PK_region_code_map PRIMARY KEY,
    lawd_cd      char(5)       NOT NULL,
    adm_cd       varchar(10)   NULL,          -- 경계 데이터(행정) 코드
    prev_lawd_cd char(5)       NULL,          -- 개편 전 코드
    valid_from   date          NOT NULL,
    valid_to     date          NULL,
    memo         nvarchar(200) NULL
);
CREATE INDEX IX_region_code_map_lawd ON dbo.region_code_map (lawd_cd, valid_from);

-- ── 단지 ────────────────────────────────────────────────
CREATE TABLE dbo.complex (
    complex_id   int IDENTITY  NOT NULL CONSTRAINT PK_complex PRIMARY KEY,
    display_nm   nvarchar(100) NOT NULL,
    sigungu_cd   char(5)       NOT NULL CONSTRAINT FK_complex_region REFERENCES dbo.region (sigungu_cd),
    bjd_cd       char(10)      NULL,
    jibun_addr   nvarchar(200) NULL,
    road_addr    nvarchar(200) NULL,
    lat          decimal(9,6)  NULL,          -- 내가 확정한 핀
    lng          decimal(9,6)  NULL,
    status       varchar(20)   NOT NULL CONSTRAINT DF_complex_status DEFAULT 'INTEREST'
                 CONSTRAINT CK_complex_status CHECK (status IN ('INTEREST','VISIT_PLANNED','VISITED','CANDIDATE','ON_HOLD','EXCLUDED')),
    created_at   datetime2(0)  NOT NULL CONSTRAINT DF_complex_created DEFAULT SYSDATETIME(),
    updated_at   datetime2(0)  NOT NULL CONSTRAINT DF_complex_updated DEFAULT SYSDATETIME()
);
CREATE INDEX IX_complex_sigungu ON dbo.complex (sigungu_cd);

CREATE TABLE dbo.complex_ext_id (
    ext_row_id   int IDENTITY  NOT NULL CONSTRAINT PK_complex_ext_id PRIMARY KEY,
    complex_id   int           NOT NULL CONSTRAINT FK_complex_ext_id_complex REFERENCES dbo.complex (complex_id),
    source       varchar(20)   NOT NULL CONSTRAINT CK_complex_ext_id_source CHECK (source IN ('KAPT','RTMS_APTSEQ','BLD')),
    ext_id       varchar(50)   NOT NULL,
    valid_from   date          NOT NULL,
    valid_to     date          NULL
);
CREATE UNIQUE INDEX UX_complex_ext_id_current ON dbo.complex_ext_id (source, ext_id) WHERE valid_to IS NULL;
CREATE INDEX IX_complex_ext_id_complex ON dbo.complex_ext_id (complex_id);

CREATE TABLE dbo.master_revision (
    rev_id       int IDENTITY  NOT NULL CONSTRAINT PK_master_revision PRIMARY KEY,
    complex_id   int           NOT NULL CONSTRAINT FK_master_revision_complex REFERENCES dbo.complex (complex_id),
    status       varchar(12)   NOT NULL CONSTRAINT CK_master_revision_status CHECK (status IN ('CURRENT','PENDING','REJECTED','SUPERSEDED')),
    use_apr_day  date          NULL,
    hhld_cnt     int           NULL,
    dong_cnt     int           NULL,
    max_floor    int           NULL,
    builder      nvarchar(100) NULL,
    heat_type    nvarchar(50)  NULL,
    hall_type    nvarchar(50)  NULL,
    far_ratio    decimal(7,2)  NULL,
    bc_ratio     decimal(7,2)  NULL,
    plat_area    decimal(14,2) NULL,
    park_cnt     int           NULL,
    raw_json     nvarchar(max) NULL,
    payload_hash char(64)      NOT NULL,
    fetched_at   datetime2(0)  NOT NULL,
    decided_at   datetime2(0)  NULL
);
CREATE UNIQUE INDEX UX_master_revision_current ON dbo.master_revision (complex_id) WHERE status = 'CURRENT';

CREATE TABLE dbo.area_type (
    area_type_id int IDENTITY  NOT NULL CONSTRAINT PK_area_type PRIMARY KEY,
    complex_id   int           NOT NULL CONSTRAINT FK_area_type_complex REFERENCES dbo.complex (complex_id),
    label        nvarchar(20)  NOT NULL,
    excl_m2      decimal(7,2)  NOT NULL,
    supply_m2    decimal(7,2)  NULL,
    rooms        tinyint       NULL,
    baths        tinyint       NULL,
    hhld_cnt     int           NULL,
    is_primary   bit           NOT NULL CONSTRAINT DF_area_type_primary DEFAULT 0,
    sort         int           NOT NULL CONSTRAINT DF_area_type_sort DEFAULT 0
);
CREATE UNIQUE INDEX UX_area_type_primary ON dbo.area_type (complex_id) WHERE is_primary = 1;

CREATE TABLE dbo.complex_tag (
    complex_id   int           NOT NULL CONSTRAINT FK_complex_tag_complex REFERENCES dbo.complex (complex_id),
    tag          nvarchar(30)  NOT NULL,
    CONSTRAINT PK_complex_tag PRIMARY KEY (complex_id, tag)
);

-- ── 필드 메타 ───────────────────────────────────────────
CREATE TABLE dbo.field_def (
    field_cd         varchar(40)  NOT NULL CONSTRAINT PK_field_def PRIMARY KEY,
    label            nvarchar(50) NOT NULL,
    category         varchar(20)  NOT NULL CONSTRAINT CK_field_def_category CHECK (category IN ('TRAFFIC','ENV','EDU','PRICE','REDEV','NOTE')),
    data_type        varchar(10)  NOT NULL CONSTRAINT CK_field_def_type CHECK (data_type IN ('num','text','date','bool','enum')),
    unit             nvarchar(10) NULL,
    scope            varchar(10)  NOT NULL CONSTRAINT CK_field_def_scope CHECK (scope IN ('COMPLEX','AREA')),
    diff_mode        varchar(5)   NOT NULL CONSTRAINT CK_field_def_diff CHECK (diff_mode IN ('ABS','PCT','BOTH','NONE')),
    better           varchar(5)   NOT NULL CONSTRAINT CK_field_def_better CHECK (better IN ('UP','DOWN','NONE')),
    carry_forward    bit          NOT NULL,
    confirm_on_carry bit          NOT NULL CONSTRAINT DF_field_def_confirm DEFAULT 0,   -- 복사값 그대로 저장 시 확인 안내
    sort             int          NOT NULL,
    active           bit          NOT NULL CONSTRAINT DF_field_def_active DEFAULT 1
);

CREATE TABLE dbo.enum_def (
    field_cd     varchar(40)  NOT NULL CONSTRAINT FK_enum_def_field REFERENCES dbo.field_def (field_cd),
    code         varchar(30)  NOT NULL,
    label        nvarchar(30) NOT NULL,
    ord          int          NOT NULL,
    CONSTRAINT PK_enum_def PRIMARY KEY (field_cd, code)
);

-- ── 스냅샷 (append-only) ────────────────────────────────
CREATE TABLE dbo.snapshot (
    snapshot_id   bigint IDENTITY NOT NULL CONSTRAINT PK_snapshot PRIMARY KEY,
    complex_id    int            NOT NULL CONSTRAINT FK_snapshot_complex REFERENCES dbo.complex (complex_id),
    observed_at   date           NOT NULL,
    input_at      datetime2(0)   NOT NULL CONSTRAINT DF_snapshot_input DEFAULT SYSDATETIME(),
    source        varchar(10)    NOT NULL CONSTRAINT CK_snapshot_source CHECK (source IN ('VISIT','ONLINE','AGENT')),
    master_rev_id int            NULL CONSTRAINT FK_snapshot_master_rev REFERENCES dbo.master_revision (rev_id),
    supersedes_id bigint         NULL CONSTRAINT FK_snapshot_supersedes REFERENCES dbo.snapshot (snapshot_id),
    memo          nvarchar(1000) NULL
);
CREATE INDEX IX_snapshot_complex_observed ON dbo.snapshot (complex_id, observed_at);

CREATE TABLE dbo.snapshot_void (
    snapshot_id             bigint        NOT NULL CONSTRAINT PK_snapshot_void PRIMARY KEY
                            CONSTRAINT FK_snapshot_void_snapshot REFERENCES dbo.snapshot (snapshot_id),
    voided_at               datetime2(0)  NOT NULL CONSTRAINT DF_snapshot_void_at DEFAULT SYSDATETIME(),
    reason                  nvarchar(500) NOT NULL,
    replaced_by_snapshot_id bigint        NULL CONSTRAINT FK_snapshot_void_replaced REFERENCES dbo.snapshot (snapshot_id)
);

CREATE TABLE dbo.snapshot_value (
    value_id              bigint IDENTITY NOT NULL CONSTRAINT PK_snapshot_value PRIMARY KEY,
    snapshot_id           bigint         NOT NULL CONSTRAINT FK_snapshot_value_snapshot REFERENCES dbo.snapshot (snapshot_id),
    field_cd              varchar(40)    NOT NULL CONSTRAINT FK_snapshot_value_field REFERENCES dbo.field_def (field_cd),
    area_type_id          int            NULL CONSTRAINT FK_snapshot_value_area REFERENCES dbo.area_type (area_type_id),  -- NULL = 단지 단위
    num_val               decimal(18,4)  NULL,
    text_val              nvarchar(4000) NULL,
    date_val              date           NULL,
    carried_from_value_id bigint         NULL CONSTRAINT FK_snapshot_value_carried REFERENCES dbo.snapshot_value (value_id),  -- 최초 관측 원본
    CONSTRAINT UQ_snapshot_value UNIQUE (snapshot_id, field_cd, area_type_id)
);
CREATE INDEX IX_snapshot_value_field ON dbo.snapshot_value (field_cd, area_type_id) INCLUDE (num_val);

-- ── 기준점·소요시간 ─────────────────────────────────────
CREATE TABLE dbo.anchor (
    anchor_id    int IDENTITY  NOT NULL CONSTRAINT PK_anchor PRIMARY KEY,
    name         nvarchar(50)  NOT NULL CONSTRAINT UQ_anchor_name UNIQUE,
    kind         varchar(10)   NOT NULL CONSTRAINT CK_anchor_kind CHECK (kind IN ('CBD','WORK')),
    lat          decimal(9,6)  NULL,
    lng          decimal(9,6)  NULL,
    sort         int           NOT NULL CONSTRAINT DF_anchor_sort DEFAULT 0,
    active       bit           NOT NULL CONSTRAINT DF_anchor_active DEFAULT 1
);

CREATE TABLE dbo.commute (
    commute_id             bigint IDENTITY NOT NULL CONSTRAINT PK_commute PRIMARY KEY,
    snapshot_id            bigint        NOT NULL CONSTRAINT FK_commute_snapshot REFERENCES dbo.snapshot (snapshot_id),
    anchor_id              int           NOT NULL CONSTRAINT FK_commute_anchor REFERENCES dbo.anchor (anchor_id),
    mode                   varchar(10)   NOT NULL CONSTRAINT CK_commute_mode CHECK (mode IN ('TRANSIT','CAR','WALK','BIKE')),
    minutes                smallint      NOT NULL,
    transfers              tinyint       NULL,
    route_desc             nvarchar(300) NULL,
    suggested_minutes      smallint      NULL,     -- 카카오 제안값 (참고 기록)
    carried_from_commute_id bigint       NULL CONSTRAINT FK_commute_carried REFERENCES dbo.commute (commute_id),
    CONSTRAINT UQ_commute UNIQUE (snapshot_id, anchor_id, mode)
);

-- ── 학군 ────────────────────────────────────────────────
CREATE TABLE dbo.school (
    school_id    int IDENTITY  NOT NULL CONSTRAINT PK_school PRIMARY KEY,
    school_nm    nvarchar(50)  NOT NULL,
    school_kind  varchar(10)   NOT NULL CONSTRAINT CK_school_kind CHECK (school_kind IN ('ELEM','MIDDLE','HIGH')),
    sigungu_cd   char(5)       NULL,
    address      nvarchar(200) NULL,
    lat          decimal(9,6)  NULL,
    lng          decimal(9,6)  NULL
);

CREATE TABLE dbo.school_stat (
    school_id    int           NOT NULL CONSTRAINT FK_school_stat_school REFERENCES dbo.school (school_id),
    stat_year    smallint      NOT NULL,
    metric_cd    varchar(30)   NOT NULL,
    metric_desc  nvarchar(200) NOT NULL,     -- 지표 정의·출처 (U10)
    value        decimal(9,4)  NOT NULL,
    CONSTRAINT PK_school_stat PRIMARY KEY (school_id, stat_year, metric_cd)
);

CREATE TABLE dbo.complex_school (
    complex_school_id int IDENTITY NOT NULL CONSTRAINT PK_complex_school PRIMARY KEY,
    complex_id   int           NOT NULL CONSTRAINT FK_complex_school_complex REFERENCES dbo.complex (complex_id),
    school_id    int           NOT NULL CONSTRAINT FK_complex_school_school REFERENCES dbo.school (school_id),
    valid_from   date          NOT NULL,
    valid_to     date          NULL,
    walk_min     smallint      NULL,
    bus_min      smallint      NULL,
    memo         nvarchar(300) NULL
);
CREATE INDEX IX_complex_school_complex ON dbo.complex_school (complex_id);

-- ── 미디어 ──────────────────────────────────────────────
CREATE TABLE dbo.media (
    media_id     bigint IDENTITY NOT NULL CONSTRAINT PK_media PRIMARY KEY,
    complex_id   int           NOT NULL CONSTRAINT FK_media_complex REFERENCES dbo.complex (complex_id),
    snapshot_id  bigint        NULL CONSTRAINT FK_media_snapshot REFERENCES dbo.snapshot (snapshot_id),
    kind         varchar(15)   NOT NULL CONSTRAINT CK_media_kind CHECK (kind IN ('PHOTO','PRICE_CAPTURE','MAP_CAPTURE','OTHER')),
    rel_path     nvarchar(260) NOT NULL,
    thumb_path   nvarchar(260) NULL,
    orig_name    nvarchar(260) NULL,
    sha256       char(64)      NOT NULL CONSTRAINT UQ_media_sha256 UNIQUE,
    mime         varchar(50)   NOT NULL,
    bytes        bigint        NOT NULL,
    w            int           NULL,
    h            int           NULL,
    taken_at     datetime2(0)  NULL,
    gps_lat      decimal(9,6)  NULL,
    gps_lng      decimal(9,6)  NULL,
    caption      nvarchar(500) NULL,
    created_at   datetime2(0)  NOT NULL CONSTRAINT DF_media_created DEFAULT SYSDATETIME()
);
CREATE INDEX IX_media_complex ON dbo.media (complex_id, snapshot_id);

-- ── 실거래 (외부 수집, UPDATE 허용) ─────────────────────
CREATE TABLE dbo.trade (
    trade_id         bigint IDENTITY NOT NULL CONSTRAINT PK_trade PRIMARY KEY,
    complex_id       int           NULL CONSTRAINT FK_trade_complex REFERENCES dbo.complex (complex_id),
    sigungu_cd       char(5)       NOT NULL,
    apt_seq          varchar(30)   NOT NULL,
    apt_nm           nvarchar(100) NULL,
    jibun            nvarchar(30)  NULL,
    deal_date        date          NOT NULL,
    excl_m2          decimal(7,2)  NOT NULL,
    floor            smallint      NULL,
    dong             nvarchar(20)  NULL,
    amount_man       int           NOT NULL,
    cancel_flag      bit           NOT NULL CONSTRAINT DF_trade_cancel DEFAULT 0,
    cancel_date      date          NULL,
    dup_seq          smallint      NOT NULL CONSTRAINT DF_trade_dup DEFAULT 1,
    natural_key_hash char(64)      NOT NULL,      -- 해제 여부·해제일 제외 (계획서 §4.2)
    first_seen_at    datetime2(0)  NOT NULL CONSTRAINT DF_trade_first DEFAULT SYSDATETIME(),
    last_seen_at     datetime2(0)  NOT NULL CONSTRAINT DF_trade_last DEFAULT SYSDATETIME(),
    CONSTRAINT UQ_trade_key UNIQUE (natural_key_hash, dup_seq)
);
CREATE INDEX IX_trade_complex_date ON dbo.trade (complex_id, deal_date);
CREATE INDEX IX_trade_aptseq ON dbo.trade (apt_seq, deal_date);

CREATE TABLE dbo.trade_rent (
    rent_id          bigint IDENTITY NOT NULL CONSTRAINT PK_trade_rent PRIMARY KEY,
    complex_id       int           NULL CONSTRAINT FK_trade_rent_complex REFERENCES dbo.complex (complex_id),
    sigungu_cd       char(5)       NOT NULL,
    apt_seq          varchar(30)   NULL,
    apt_nm           nvarchar(100) NULL,
    jibun            nvarchar(30)  NULL,
    deal_date        date          NOT NULL,
    excl_m2          decimal(7,2)  NOT NULL,
    floor            smallint      NULL,
    deposit_man      int           NOT NULL,
    monthly_man      int           NOT NULL CONSTRAINT DF_trade_rent_monthly DEFAULT 0,
    contract_type    nvarchar(10)  NULL,        -- 신규/갱신
    contract_term    nvarchar(30)  NULL,
    dup_seq          smallint      NOT NULL CONSTRAINT DF_trade_rent_dup DEFAULT 1,
    natural_key_hash char(64)      NOT NULL,
    first_seen_at    datetime2(0)  NOT NULL CONSTRAINT DF_trade_rent_first DEFAULT SYSDATETIME(),
    last_seen_at     datetime2(0)  NOT NULL CONSTRAINT DF_trade_rent_last DEFAULT SYSDATETIME(),
    CONSTRAINT UQ_trade_rent_key UNIQUE (natural_key_hash, dup_seq)
);
CREATE INDEX IX_trade_rent_complex_date ON dbo.trade_rent (complex_id, deal_date);

-- ── 정비사업 참고 ───────────────────────────────────────
CREATE TABLE dbo.redev_ref (
    redev_ref_id int IDENTITY  NOT NULL CONSTRAINT PK_redev_ref PRIMARY KEY,
    base_year    smallint      NOT NULL,
    sido_nm      nvarchar(20)  NOT NULL,
    sgg_nm       nvarchar(30)  NOT NULL,
    zone_nm      nvarchar(200) NOT NULL,
    stage        nvarchar(50)  NULL,
    biz_type     nvarchar(50)  NULL,
    operator_nm  nvarchar(200) NULL,
    supply_hhld  int           NULL,
    complex_id   int           NULL CONSTRAINT FK_redev_ref_complex REFERENCES dbo.complex (complex_id),  -- 수동 링크
    loaded_at    datetime2(0)  NOT NULL CONSTRAINT DF_redev_ref_loaded DEFAULT SYSDATETIME()
);

-- ── 비교 기록 ───────────────────────────────────────────
CREATE TABLE dbo.comparison (
    comparison_id int IDENTITY  NOT NULL CONSTRAINT PK_comparison PRIMARY KEY,
    as_of         date          NOT NULL,
    title         nvarchar(100) NOT NULL,
    conclusion    nvarchar(4000) NULL,
    created_at    datetime2(0)  NOT NULL CONSTRAINT DF_comparison_created DEFAULT SYSDATETIME()
);

CREATE TABLE dbo.comparison_item (
    comparison_id int    NOT NULL CONSTRAINT FK_comparison_item_comparison REFERENCES dbo.comparison (comparison_id),
    complex_id    int    NOT NULL CONSTRAINT FK_comparison_item_complex REFERENCES dbo.complex (complex_id),
    snapshot_id   bigint NULL CONSTRAINT FK_comparison_item_snapshot REFERENCES dbo.snapshot (snapshot_id),
    area_type_id  int    NULL CONSTRAINT FK_comparison_item_area REFERENCES dbo.area_type (area_type_id),
    sort          int    NOT NULL CONSTRAINT DF_comparison_item_sort DEFAULT 0,
    CONSTRAINT PK_comparison_item PRIMARY KEY (comparison_id, complex_id)
);

-- ── 운영 ────────────────────────────────────────────────
CREATE TABLE dbo.sync_log (
    log_id       bigint IDENTITY NOT NULL CONSTRAINT PK_sync_log PRIMARY KEY,
    job          varchar(40)    NOT NULL,
    api_cd       varchar(30)    NULL,
    complex_id   int            NULL,
    started_at   datetime2(3)   NOT NULL,
    ended_at     datetime2(3)   NULL,
    ok           bit            NOT NULL,
    http_status  int            NULL,
    message      nvarchar(2000) NULL,
    detail_json  nvarchar(max)  NULL
);
CREATE INDEX IX_sync_log_started ON dbo.sync_log (started_at DESC);

CREATE TABLE dbo.setting (
    setting_key  varchar(60)    NOT NULL CONSTRAINT PK_setting PRIMARY KEY,
    setting_val  nvarchar(1000) NULL,
    updated_at   datetime2(0)   NOT NULL CONSTRAINT DF_setting_updated DEFAULT SYSDATETIME()
);

CREATE TABLE dbo.api_quota (
    api_cd       varchar(30) NOT NULL,
    period_type  varchar(5)  NOT NULL CONSTRAINT CK_api_quota_period CHECK (period_type IN ('DAY','MONTH')),
    period_key   char(8)     NOT NULL,     -- DAY: yyyyMMdd, MONTH: yyyyMM
    call_cnt     int         NOT NULL CONSTRAINT DF_api_quota_cnt DEFAULT 0,
    limit_cnt    int         NOT NULL,
    CONSTRAINT PK_api_quota PRIMARY KEY (api_cd, period_type, period_key)
);
GO

-- ── 뷰 (계획서 §4.3) ────────────────────────────────────
CREATE OR ALTER VIEW dbo.v_snapshot_active AS
SELECT s.snapshot_id, s.complex_id, s.observed_at, s.input_at, s.source, s.master_rev_id, s.supersedes_id, s.memo
FROM dbo.snapshot s
WHERE NOT EXISTS (SELECT 1 FROM dbo.snapshot_void x WHERE x.snapshot_id = s.snapshot_id);
GO

-- 실효 관측일: 복사값은 원본 값이 속한 스냅샷의 관측일
CREATE OR ALTER VIEW dbo.v_snapshot_value_eff AS
SELECT s.complex_id, s.snapshot_id, s.observed_at,
       sv.value_id, sv.field_cd, sv.area_type_id, sv.num_val, sv.text_val, sv.date_val,
       sv.carried_from_value_id,
       CAST(CASE WHEN sv.carried_from_value_id IS NULL THEN 0 ELSE 1 END AS bit) AS is_carried,
       COALESCE(os.observed_at, s.observed_at) AS eff_observed_at
FROM dbo.v_snapshot_active s
JOIN dbo.snapshot_value sv ON sv.snapshot_id = s.snapshot_id
LEFT JOIN dbo.snapshot_value ov ON ov.value_id = sv.carried_from_value_id
LEFT JOIN dbo.snapshot os ON os.snapshot_id = ov.snapshot_id;
GO

-- 수치 증감: 실제 관측값끼리만 비교 (복사값 제외)
CREATE OR ALTER VIEW dbo.v_snapshot_diff AS
WITH v AS (
    SELECT s.complex_id, s.snapshot_id, s.observed_at,
           sv.field_cd, sv.area_type_id, sv.num_val,
           LAG(sv.num_val)    OVER w AS prev_val,
           LAG(s.observed_at) OVER w AS prev_at
    FROM dbo.v_snapshot_active s
    JOIN dbo.snapshot_value sv ON sv.snapshot_id = s.snapshot_id
    WHERE sv.num_val IS NOT NULL
      AND sv.carried_from_value_id IS NULL
    WINDOW w AS (PARTITION BY s.complex_id, sv.field_cd, sv.area_type_id
                 ORDER BY s.observed_at, s.snapshot_id)
)
SELECT complex_id, snapshot_id, observed_at, field_cd, area_type_id,
       num_val, prev_val, prev_at,
       num_val - prev_val AS delta,
       CASE WHEN prev_val IS NULL OR prev_val = 0 THEN NULL
            ELSE (num_val - prev_val) * 100.0 / prev_val END AS delta_pct
FROM v;
GO

-- 텍스트·enum·날짜·bool 변경 감지 (실제 관측값 기준)
CREATE OR ALTER VIEW dbo.v_snapshot_text_diff AS
WITH v AS (
    SELECT s.complex_id, s.snapshot_id, s.observed_at,
           sv.field_cd, sv.area_type_id,
           COALESCE(sv.text_val, CONVERT(nvarchar(10), sv.date_val, 23)) AS val,
           LAG(COALESCE(sv.text_val, CONVERT(nvarchar(10), sv.date_val, 23))) OVER w AS prev_val,
           LAG(s.observed_at) OVER w AS prev_at
    FROM dbo.v_snapshot_active s
    JOIN dbo.snapshot_value sv ON sv.snapshot_id = s.snapshot_id
    JOIN dbo.field_def f ON f.field_cd = sv.field_cd
    WHERE f.data_type IN ('text','enum','date')
      AND sv.carried_from_value_id IS NULL
    WINDOW w AS (PARTITION BY s.complex_id, sv.field_cd, sv.area_type_id
                 ORDER BY s.observed_at, s.snapshot_id)
)
SELECT complex_id, snapshot_id, observed_at, field_cd, area_type_id, val, prev_val, prev_at,
       CAST(CASE WHEN prev_at IS NULL THEN 0
                 WHEN val = prev_val OR (val IS NULL AND prev_val IS NULL) THEN 0
                 ELSE 1 END AS bit) AS changed
FROM v;
GO
