# CLAUDE.md — AptLog 작업 규칙

기준 문서: `APTLOG_DEV_PLAN.md` (요구사항·스키마·API·단계·완료 기준). 충돌 시 계획서가 우선이며, 변경이 필요하면 계획서를 먼저 수정한다(§14 개정 이력에 기록).

## 작업 방식
- 단계(P0→P5) 순서로 진행하고, 각 단계 완료 기준(§11)을 충족했는지 확인 후 다음 단계로. MVP는 P0~P2.
- 계획서 §12 "불확실" 항목은 추측으로 구현하지 말고 실제 응답/문서로 확인 후 반영, 결과를 계획서에 갱신.
- 외부 API 응답 필드명은 실제 호출 결과로 확인하고 zod 스키마로 고정.
- Vite 8, Pinia 4, vue-router 5, Express 5, zod 4는 최근 메이저 버전 → 기억에 의존하지 말고 공식 문서·마이그레이션 가이드로 API 확인.

## 코드 규칙
- 스택: Vue 3.5 + Vite 8 + Pinia 4, Express 5 + mssql 12, Node 24 LTS, SQL Server 2025 Express(`.\SQLEXPRESS`, 포트 1433).
- DevExtreme 사용 금지(라이선스). UI는 PrimeVue, 차트는 ECharts(`echarts/core` 모듈 import)를 래퍼 컴포넌트로 감싼다.
- 지도 SDK는 `web/src/map/MapAdapter` 인터페이스 뒤에서만 호출.
- 금액은 DB·API 모두 만원 정수. 억 변환은 화면에서만.
- 일시는 KST 로컬 시각. mssql `useUTC: false`, 관측일은 `date`, 그 외 `datetime2`.
- `snapshot`·`snapshot_value`·`snapshot_void`는 INSERT만. UPDATE/DELETE 금지(예외 없음) → 정정본 생성 또는 `snapshot_void` INSERT. 조회는 `v_snapshot_active` 기준.
- carry_forward로 복사한 값은 `carried_from_value_id`를 채우고, 증감은 실제 관측값끼리만 계산.
- DB 변경은 `db/migrations/NNN_*.sql` 신규 파일로만. 기존 마이그레이션 수정 금지.
- 가계 DB(`HH_*`) 이름은 코드·뷰에 직접 쓰지 않고 시노님 + sqlcmd 변수(`HH_DB`)로만 참조.
- 화면 로딩 경로에서 외부 API 호출 금지(등록·동기화·배치에서만).
- 모든 외부 API 호출은 `api/src/external/quota.js` 쿼터 가드를 거친다(우회 호출 금지).
- 외부 API 결과(지오코딩, 대중교통)는 제안값이며 사용자가 확정한 값만 저장.
- 비밀값은 `.env`만. `NCP_KEY_ID` 외 키는 프론트로 내보내지 않는다.
- `HOST`가 127.0.0.1이 아니면 `API_TOKEN` 인증 필수.
- 크롤링 코드 작성 금지.

## 안전
- 파일 삭제, DB DROP/TRUNCATE, 백업 스크립트의 `robocopy /MIR` 사용 금지. 필요 시 사용자 확인.
  - 유일한 예외: `scripts/backup.ps1`의 보관 정리 — `BACKUP_ROOT\db\RealtyLog_*_yyyyMMdd.bak` 패턴 중 14일 경과 파일만 삭제(계획서 §8).
- 운영 DB(`RealtyLog_PROD`) 대상 마이그레이션 전 백업 실행. 개발·테스트는 `RealtyLog_DEV`에서.
- SQL Server 구성 변경(포트·서비스 재시작·로그인 생성)은 관리자 권한 작업이므로 사용자에게 안내하고 직접 실행하게 한다.
