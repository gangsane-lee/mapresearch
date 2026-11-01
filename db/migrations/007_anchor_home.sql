/*
  007_anchor_home — 기준점 종류에 "현재 집"(HOME) 추가
  지금 사는 집을 기준점으로 두면 후보 단지마다 현재 집까지의 직선거리·대중교통 시간을 비교할 수 있다.
*/
ALTER TABLE dbo.anchor DROP CONSTRAINT CK_anchor_kind;
ALTER TABLE dbo.anchor ADD CONSTRAINT CK_anchor_kind CHECK (kind IN ('CBD', 'WORK', 'HOME'));
