/*
  004_kapt_ref_trade_site — 실제 응답 확인 결과 반영 (계획서 §12 U3, §14 2026-11-01)

  1) kapt_ref: 한국부동산원 "공동주택 단지 식별정보_기본정보" CSV (scripts/import-kapt.js 로 적재)
     - 단지 등록 검색·마스터(사용승인일·세대수·동수) 출처. K-apt 목록 API 대신 사용.
     - 참조 데이터라 재적재 시 갱신(MERGE). 스냅샷 계열이 아니다.
  2) 아파트 매매 실거래(RTMSDataSvcAptTrade) 응답에는 aptSeq 가 없다 → trade.apt_seq NULL 허용,
     단지 연결은 법정동코드 + 지번(bjd_cd, jibun)으로 한다. 응답의 법정동명(umdNm)은 kapt_ref 로 코드 변환.
  3) complex.jibun: 단지 대표 지번(실거래 연결 키). K-apt 등록 시 PNU 에서 채운다.
*/
CREATE TABLE dbo.kapt_ref (
    danji_id     char(14)      NOT NULL CONSTRAINT PK_kapt_ref PRIMARY KEY,   -- 단지고유번호
    pnu          char(19)      NOT NULL,      -- 필지고유번호: 법정동10 + 산1 + 본번4 + 부번4
    sigungu_cd   char(5)       NOT NULL,
    bjd_cd       char(10)      NOT NULL,
    umd_nm       nvarchar(40)  NOT NULL,      -- 주소의 읍면동(리) 부분 — 실거래 umdNm 과 대응
    jibun        nvarchar(30)  NOT NULL,      -- '1708', '602-17', '산12'
    addr         nvarchar(200) NOT NULL,
    nm_price     nvarchar(100) NULL,          -- 단지명_공시가격
    nm_bld       nvarchar(100) NULL,          -- 단지명_건축물대장
    nm_road      nvarchar(100) NULL,          -- 단지명_도로명주소
    danji_kind   tinyint       NULL,          -- 단지종류 (1 아파트 / 2 연립 / 3 다세대 — 데이터의 단지명으로 확인, 코드표는 미확인)
    dong_cnt     int           NULL,
    hhld_cnt     int           NULL,
    use_apr_day  date          NULL,
    road_addr    nvarchar(200) NULL,
    base_date    date          NOT NULL,      -- 파일 기준일 (파일명 yyyyMMdd)
    loaded_at    datetime2(0)  NOT NULL CONSTRAINT DF_kapt_ref_loaded DEFAULT SYSDATETIME()
);
CREATE INDEX IX_kapt_ref_site ON dbo.kapt_ref (bjd_cd, jibun);
CREATE INDEX IX_kapt_ref_sgg ON dbo.kapt_ref (sigungu_cd, danji_kind);
GO

ALTER TABLE dbo.trade ALTER COLUMN apt_seq varchar(30) NULL;
ALTER TABLE dbo.trade ADD bjd_cd char(10) NULL, umd_nm nvarchar(40) NULL, deal_type nvarchar(10) NULL;   -- 중개거래/직거래
ALTER TABLE dbo.trade_rent ADD bjd_cd char(10) NULL, umd_nm nvarchar(40) NULL;
ALTER TABLE dbo.complex ADD jibun nvarchar(30) NULL;
GO

CREATE INDEX IX_trade_site ON dbo.trade (bjd_cd, jibun, deal_date);
CREATE INDEX IX_trade_rent_site ON dbo.trade_rent (bjd_cd, jibun, deal_date);
CREATE INDEX IX_complex_site ON dbo.complex (bjd_cd, jibun);
GO
