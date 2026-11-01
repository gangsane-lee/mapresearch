/*
  005_area_type_note — 평형 비고 (단지 추가 화면의 평형 표 "비고" 칸)
  예: 판상형·타워형, 확장형, 테라스 등 평형별 메모. 스냅샷 대상 아님(평형 속성).
*/
ALTER TABLE dbo.area_type ADD note nvarchar(200) NULL;
