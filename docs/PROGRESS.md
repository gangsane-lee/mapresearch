# 진행 현황

> 다음 세션은 이 파일부터 읽고 "다음 할 일"부터 이어간다. 단계 완료 기준은 계획서 §11.
> 테스트: `npm test` (db·geo·api: node:test / web: vitest). 커밋은 사용자 요청 시에만.

## 검증 방식 메모
- 이 PC의 SQL Server는 Windows 인증이 공유 메모리(`lpc:`)로만 되고, Node 드라이버(tedious)는 SQL 로그인이 필요하다. 사용자가 `setup-sqlserver.ps1`로 로그인을 만들기 전까지는 **tempdb 트랜잭션 + ROLLBACK** 으로 SQL을 검증했다 (sqlcmd `-I` 필수).
- UI는 `.claude/launch.json` 의 `aptlog-preview`(DB 없는 설정)로 띄워 대체 동작(지도 키 없음·DB 없음)을 확인했다.

## P0 기반 — 코드 완료, 사용자 실행 대기

| 항목 | 상태 | 검증 |
|---|---|---|
| git init, .gitignore, .gitattributes | 완료 | — |
| `.env.example` (로그인명 `aptlog_{dev,prod}_{app,mig}`) | 완료 | — |
| `scripts/setup-sqlserver.ps1` + `db/setup/000_server_setup.sql` | 완료 | 구문 검사. **사용자 실행 필요** |
| 마이그레이션 러너 `db/run-migrations.js` | 완료 | 순수 함수 테스트. 실DB는 setup 이후 |
| `001_init.sql`, `002_app_role.sql`, seed 010/020/030 | 완료 | tempdb 검증 (뷰·권한 DENY 동작 포함) |
| Express 골격·쿼터 가드 | 완료 | 단위 테스트 + tempdb MERGE 검증 |
| 경계 빌드 `geo/build-boundaries.js` | 완료 | 합성 데이터 검증. 실데이터 다운로드는 사용자 |
| 백업/복원 스크립트 | 완료 | 구문 검사. 실제 백업→복원은 setup 이후 |

## P1 지도·등록 — 공공 API 연동 등록 제외 완료

| 항목 | 상태 |
|---|---|
| Vue 3.5 + Vite 8 + Pinia 4 + vue-router 5 골격, 빌드 | 완료 |
| MapAdapter 인터페이스, NaverMapAdapter, NullMapAdapter(키 없음/로딩 실패 시) | 완료 (실제 네이버 지도는 키 발급 후 확인) |
| 구/시 검색, fitBounds, 마스크(구멍 방향 보정), 구 안 단지 판정, 선택 구 밖 마커 투명 | 완료 (마스크 로직 테스트, 브라우저에서 검색·선택 동작 확인) |
| 말풍선 마커 (이스케이프), 상태·태그 필터, 단일/다중(Ctrl) 선택, 최대 4개 | 완료 |
| `/api/public-config`, `/api/complexes/summary` | 완료 (SQL tempdb 검증) |
| 외부 API 공통부 `external/http.js` (쿼터→타임아웃→재시도→sync_log) | 완료 (테스트) |
| `scripts/probe-api.js` — 키 발급 후 실제 응답 저장 | 완료. **사용자 실행 필요** |
| 공공 API 연동 단지 등록(K-apt·건축HUB·실거래), 실거래 배치 | **대기**: U1~U3 확인 필요 (CLAUDE.md: 추측 구현 금지) |
| 수동 단지 등록 (`POST /api/complexes/manual`, 화면) | 완료 — API 키 없이도 사용 가능 |
| GL 모드 스파이크(U7) | 대기 (키 필요) |

## P2 스냅샷 — 완료 (실DB 통합 확인만 남음)

| 항목 | 상태 |
|---|---|
| SnapshotService: 초안(복사값·실효 관측일·관측일 기준 실거래), 생성, 정정(+void), 무효, 목록, 단건, 증감, 시계열(수치·텍스트) | 완료 (SQL tempdb 검증, 검증 로직 단위 테스트) |
| 복사값 서버 재검증 (값이 같을 때만 복사로 인정, 최초 원본 id로 평탄화) | 완료 |
| 금액 정규화 `shared/unit.js` (서버·화면 공용) | 완료 |
| 스냅샷 입력 폼 (동적 폼, 복사 배지, 이번에 확인함, 저장 전 확인, 괴리율, 소요시간 표, 정정 모드) | 완료 (컴포넌트 테스트) |
| `/api/compare` (기준일 비교, 평형 지정, 실효 관측일, 괴리율·예산 대비·직전 대비, 직선거리) | 완료 (SQL tempdb 검증) |
| 요약 패널 (마스터·등급 배지·호가·스파크라인·괴리율·예산 대비·기준점) / 비교 패널 (양식 비교표, 우세·열세 강조, 관측일 흐림, 평형 선택) | 완료 (컴포넌트 테스트 + 목 서버 화면 확인) |

## P3 비교·상세 — 화면 완료

| 항목 | 상태 |
|---|---|
| ECharts 래퍼 `web/src/charts/EChart.vue` + option 생성 함수(테스트) | 완료 |
| 95% 상세 팝업 (지연 로딩 — 첫 화면 번들 150KB) | 완료 |
| 단지 상세 탭: 개요(마스터·리비전·변경 감지 반영/무시), 시세 추이, 스냅샷 이력(증감·정정·무효), 가치평가(소요시간·등급 추이), 실거래, 정비 타임라인, 메모·결론 | 완료 (목 서버로 렌더·콘솔 오류 없음 확인). 사진 탭은 P4 |
| 상세 비교: 호가 겹침 라인, 기준일 바, 등급 레이더, 변경분 행렬, 비교 결론 저장·이력 | 완료 |
| API: trades, commutes, master-diff, master-revisions accept/reject, comparisons, settings, anchors | 완료 (검증 로직 테스트) |
| A2 가중치 종합점수 (`web/src/util/score.js`, 설정 `weight.*`, 비교 패널 '종합' 행) | 완료 (테스트) |
| A8 매물 단위 | 보류 (2026-11-01 결정) |
| A10 지역 공유 값 — 첫 스냅샷이면 같은 법정동 다른 단지의 학원가·편의시설·유해시설 최신 관측값 제안("같은 동 ○○ 값" 배지) | 완료 (SQL tempdb 검증) |
| 위치 미니맵(개요 탭) | 미착수 (지도 키 필요) |
| 학교·학업성취도: `/api/schools`, `/api/complexes/:id/schools` (배정 이력 마감), 연도별 성취도(지표 정의 필수), 가치평가 탭 패널 | 완료 (SQL tempdb 검증, 입력 검증 테스트) |
| A5 보고서: `/report/:ids` 인쇄 화면 (첨부 양식 순서, 2~4개면 비교표 포함) → 브라우저 "PDF로 저장" | 완료 (목 서버 렌더 확인). Word(.docx) 생성은 미구현 |

## 설정·운영
| 항목 | 상태 |
|---|---|
| 설정 화면: 예산(억 표기 입력), 지도 엔진, 흐림 기준일, 평형 오차, 가중치, 쿼터 사용량·한도, 기준점 편집, 마지막 백업 | 완료 |
| `/api/backup/status` (last_backup.json) | 완료 |
| `scripts/install-service.ps1` (WinSW, SQL Server 의존, 실패 시 재시작) | 완료 — WinSW 실행 파일은 사용자가 받아야 함 |

## P4 자동화 — 사진만 완료

| 항목 | 상태 |
|---|---|
| 사진 업로드 (multer 메모리, MIME 화이트리스트, sharp 디코딩 검증, 480px webp 썸네일, EXIF 촬영일·GPS, sha256 중복 차단, 경로 조작 차단) | 완료 (단위 + 가짜 DB 경로 테스트) |
| 사진 탭 (스냅샷별 그룹, 다중 업로드, Ctrl+V 캡처, 같은 날 스냅샷 연결 제안, 원본 보기, 토큰 모드 blob URL) | 완료 (빌드). 실제 화면 확인은 DB 준비 후 |
| 월 실거래 배치, 마스터 재검증, 후속 단지 연결, 괴리 플래그(A3), 월 리포트(A4) | **대기**: 외부 API 응답 확인(U1~U3) 필요 |

## P4·P5 추가 (DB·키 불필요분)

| 항목 | 상태 |
|---|---|
| A3 가격 알림: 호가가 최근 실거래 대비 `flag_gap_pct`(기본 −5%) 이하, 최신 실거래 하락 → 마커 `!`, 필터 "가격 알림", 요약 패널 | 완료 (SQL tempdb 검증, 테스트) |
| A7 임장 일정: `003_visit_plan.sql`, `/api/visits`, 월 달력(계획 ●·스냅샷 ■), 완료 시 같은 날 스냅샷 자동 연결 | 완료 (SQL tempdb 검증, 테스트) |
| 정비사업 CSV: `scripts/import-redev.js` (UTF-8/EUC-KR 자동, 헤더 키워드 매핑 미리보기 → `--apply`, 같은 연도 재적재 거부), `/api/redev-refs` 단지 수동 연결, 정비 타임라인 탭 패널 | 완료 (합성 CSV로 미리보기 확인). 실제 CSV 헤더는 다운로드 후 확인 |
| A9 휴대폰 화면: 375px에서 가로 넘침 없음, 패널 전체 화면, 상단바 압축(165→118px) | 완료 (목 서버 측정). 실제 휴대폰 접속은 HOST·API_TOKEN 설정 후 |
| 실DB 통합 테스트 `api/test-db/` (`npm run test:db`, RealtyLog_TEST 전용 — 등록·스냅샷·복사값·증감·정정·무효·비교·DENY·쿼터·학교·일정) | 작성 완료, **DB 설정 전이라 건너뜀** |
| A4 월 리포트, 실거래 배치, 마스터 재검증 | 대기 (공공 API 응답 확인 필요) |
| A6 가계 예산 연동 | 대기 (U14) |

## 다음 할 일
1. **사용자**: `setup-sqlserver.ps1 -Env DEV` → `.env` → `npm run migrate` → `npm run dev:api` + `npm run dev:web` 로 실사용 확인
   - 통합 테스트용: `setup-sqlserver.ps1 -Env TEST` → `.env.test` → `npm run test:db`
2. **사용자**: admdongkor 다운로드 → `npm run geo:build`, 백업→복원 테스트
3. **사용자**: 공공데이터포털·NCP·카카오 키 → `node scripts/probe-api.js` → docs/api-samples/ 확인
4. (개발) `npm run test:db` 실제 실행·수정, probe 결과로 external/kapt·bldHub·rtms 클라이언트 + 등록·배치·A4 월 리포트 구현
5. (개발) 가계 연동(A6: U14 확인 후), 위치 미니맵(지도 키 발급 후)
