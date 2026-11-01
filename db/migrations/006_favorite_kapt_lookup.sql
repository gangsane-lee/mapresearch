/*
  006_favorite_kapt_lookup
  1) complex.is_favorite — "★ 관심" 토글 (진행 상태와 별개로 즐겨 보는 단지 표시·필터)
  2) kapt_ref 조회 인덱스 — 지도 우클릭 단지 찾기를 법정동코드 외에 읍면동+지번, 도로명주소로도 매칭
     (2026 화성시 구 신설처럼 행정구역이 바뀌면 네이버 역지오코딩의 새 코드와 단지 식별정보의 옛 코드가 다르다.
      실호출 확인: 동탄순환대로21길 54 → 네이버 4159710500, kapt_ref 4159013000)
*/
ALTER TABLE dbo.complex ADD is_favorite bit NOT NULL CONSTRAINT DF_complex_favorite DEFAULT 0;
GO
CREATE INDEX IX_kapt_ref_umd ON dbo.kapt_ref (umd_nm, jibun);
CREATE INDEX IX_kapt_ref_road ON dbo.kapt_ref (road_addr);
