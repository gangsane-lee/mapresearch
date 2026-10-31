# AptLog — 아파트 갈아타기 임장·스냅샷 기록 시스템 개발 계획서

> 작성일: 2026-10-31 (외부 API·라이브러리 정보는 이 날짜 기준 조사)
> 개정: 2026-11-01 — 개발 전 검토 반영 (§14 개정 이력)
> 용도: Claude Code로 개발을 시작하기 위한 단일 기준 문서(Single Source of Truth)
> 프로젝트명 `AptLog`는 임시명이며 변경 가능

---

## 0. 요약

| 항목 | 결정 |
|---|---|
| 목적 | 부동산 갈아타기 과정에서 확인한 아파트 정보를 **입력 시점별 스냅샷**으로 기록·비교하고, 지도 위에서 탐색 |
| 사용 환경 | Windows 개인 PC, 개인 사용 (기본 `127.0.0.1` 바인딩) |
| 프론트 | Vue 3.5 + Vite 8 + Pinia 4 + vue-router 5, 차트 ECharts 6 + vue-echarts 8 |
| 백엔드 | Node.js 24 LTS + Express 5 + mssql 12 |
| DB | SQL Server 2025 Express (`.\SQLEXPRESS`, 고정 포트 1433), DB명 `RealtyLog_DEV` / `RealtyLog_PROD` (가계 시스템 `HH_DEV` / `HH_PROD`와 같은 인스턴스, DB만 분리) |
| 파일 | 사진·캡처는 파일시스템 저장 + DB에는 메타데이터만 |
| 지도 | 네이버 지도 신규 Maps (Web Dynamic Map, `ncpKeyId`), 대체 후보 카카오맵 |
| 외부 데이터 | 공공데이터포털(K-apt 공동주택 정보, 건축HUB 건축물대장, 아파트 매매·전월세 실거래), 카카오 대중교통 경로(제안값), 국토부 정비사업 통합 CSV |
| 핵심 원칙 | ① 불변/준정적/시계열 3계층 분리 ② 스냅샷 append-only (UPDATE 예외 없음, 무효화도 INSERT) ③ 화면은 로컬 DB만 읽고 외부 API는 등록·배치 때만 ④ 외부 API 결과는 "제안", 저장은 "내가 확정한 값" ⑤ 유료 전환 가능 API는 서버 쿼터 가드로 차단 |
| MVP | P0~P2 (지도·등록·스냅샷·증감). P3 이후는 MVP 사용 후 우선순위 재조정 |

---

## 1. 요구사항

### 1.1 사용자 원 요구사항 (누락 금지)

1. 내가 확인한 아파트 정보를 **그때그때 기록**하고, 입력 시점의 아파트 정보를 DB에 **스냅샷**으로 남긴다.
2. 스냅샷 이력을 불러와 **라인·바 차트**로 보고, **변경분(증감)**을 계산해서 본다.
3. 단지 간 **비교** 시에도 이력을 불러와 비교한다.
4. 베이스 지도는 **네이버/구글 등 최신 지도**를 쓰고, 그 위에 내가 저장한 아파트 위치와 입력 정보가 **클릭 가능하게** 표시된다.
5. 지도에서 **구 단위로 검색**하면 해당 구가 화면에 **꽉 차게** 보이고, 나머지 구는 **음영** 처리된다.
6. 검색한 구 안에 내가 입력한 아파트가 있으면 **말풍선** 등으로 표시된다.
7. 아파트를 **단일 선택**하면 화면 우측 사이드바에 **요약 페이지**가 뜬다.
8. **복수 선택**하면 우측 사이드바에 **비교 페이지**(요약 정보)가 뜬다.
9. 단일/복수 페이지 모두 **상세페이지 버튼**이 있고, 누르면 화면의 **약 95%를 차지하는 팝업**으로 상세 페이지가 보기 좋게 표시된다.
10. 위치·연식 등 **시간이 지나도 변하지 않는 정보**는 내가 입력하지 않고 **자동 조회·저장**된다.
11. **재건축/재개발**로 불변 정보가 바뀔 수 있으므로, 추가 입력 시 **변경 사항을 확인**할 수 있게 보여준다.
12. **이미지 등**도 저장된다.
13. **MSSQL 등 DB 서버** 사용 (필요 없다면 파일 기반도 가능 → 가계 시스템 연동 때문에 MSSQL로 결정).
14. 입력 정보는 **첨부 임장 보고서 양식**(§3)을 따른다.
15. 지도는 **무료**여야 하고 **속도가 빨라야** 한다.

### 1.2 비기능 요구사항

| 항목 | 목표 |
|---|---|
| 첫 화면 로딩 | 1.5초 이내 (로컬) |
| 구 선택 → 화면 맞춤 + 음영 | 100ms 이내 |
| 마커 클릭 → 우측 패널 | 체감 즉시 (메모리 데이터) |
| 외부 API 장애 | 데이터 API 장애는 화면 사용에 영향 없음 (등록·배치에서만 호출). 단, 지도 SDK·타일은 외부 의존이므로 인터넷 단절 시 지도는 표시 불가 → 이때도 단지 목록·패널·상세 팝업은 정상 동작 |
| 지도 비용 | 0원 (콘솔 한도 설정으로 과금 원천 차단) |
| 데이터 보존 | 스냅샷은 삭제·수정하지 않고 정정본으로 대체 (이력 보존) |
| 백업 | DB 일 1회 + 미디어 폴더 증분 복사 |

---

## 2. 아키텍처

### 2.1 구성도

```
┌──────────────────────── Windows 개인 PC ─────────────────────────┐
│                                                                   │
│  [Vue 3.5 SPA (Vite 8)]  지도 · 우측 패널 · 95% 상세 팝업 · 입력폼  │──► 네이버 Maps (지도 타일, 지오코딩)
│          │  REST (JSON)                                           │
│          ▼                                                        │
│  [Express 5 API (Node 22)]  REST · 동기화 배치 · 변경분 계산        │──► 공공데이터포털 (K-apt, 건축HUB, 실거래)
│          │                          │                             │──► 카카오 대중교통 경로 (제안값)
│          ▼                          ▼                             │──► 국토부 정비사업 CSV (연 1회 수동 적재)
│  [MSSQL 2025 Express]        [미디어 폴더]                         │
│   RealtyLog_* DB             원본 + webp 썸네일                    │
│          │ (읽기 전용 뷰)                                          │
│          ▼                                                        │
│  [가계 통합 시스템 DB]  같은 인스턴스                               │
│                                                                   │
│  [시군구 GeoJSON]  정적 파일, SPA가 직접 로드                       │
└───────────────────────────────────────────────────────────────────┘
```

- Express가 빌드된 SPA까지 정적 서빙 → **포트 하나**로 운영.
  - Express 5는 path-to-regexp v8 사용 → SPA fallback 와일드카드는 `'*'`가 아니라 `'/{*splat}'` 문법.
- Windows 서비스 등록: **WinSW** (NSSM은 유지보수 중단으로 사용하지 않음).
- 기본 `127.0.0.1` 바인딩. 같은 망 다른 PC(휴대폰 포함) 접속이 필요하면 `0.0.0.0` + Windows 방화벽 인바운드 규칙 추가.
  - `0.0.0.0` 바인딩 시 **API 토큰 인증 필수** (`.env` `API_TOKEN`, 미설정이면 서버가 기동 거부). 127.0.0.1 전용일 때는 생략 가능.
  - 실행 PC가 Windows 10 Home(2026-10 ESU 종료, 보안 업데이트 없음)이므로 LAN 노출은 신뢰된 가정 Wi-Fi로 한정.

### 2.1.1 실행 환경 (2026-10-31 실측)

| 항목 | 실측값 | 조치 |
|---|---|---|
| OS | Windows 10 Home 22H2 (19045) | LAN 노출 최소화 (위 참조) |
| Node.js | v24.15.0 / npm 11.12.1 | 계획서 기준을 Node 24 LTS로 변경 |
| SQL Server | 2025 RTM 17.0.1000.7 Express, 인스턴스 `SQLEXPRESS` | `WINDOW` 절 사용 가능 (U12 해결) |
| SQL Browser | 비활성(Disabled) | 인스턴스명 해석 불가 → 포트 직접 지정 |
| TCP/IP | **이미 `127.0.0.1:1433`, `::1:1433` 고정 리슨 중** (IP별 설정, 2026-11-01 재확인. 가계 시스템이 사용 중) | **변경·재시작 불필요**. 외부 IP로는 리슨하지 않음 |
| 인증 모드 | 혼합 모드. 기존 로그인 `hh_dev_app`/`hh_dev_mig`/`hh_prod_app`/`hh_prod_mig` | 같은 규칙으로 **`aptlog_{dev,prod}_app` / `aptlog_{dev,prod}_mig`** 생성 (`scripts/setup-sqlserver.ps1`) |
| 서버 정렬 | `Korean_Wansung_CI_AS` | RealtyLog_* 도 같은 정렬로 생성 |
| 기존 DB | `HH_DEV`, `HH_PROD` (호환성 170) | AptLog도 DEV/PROD 분리 |
| Windows 인증 | 공유 메모리(`lpc:.\SQLEXPRESS`)만 성공, TCP는 SSPI 오류 | 관리 스크립트(sqlcmd)는 `lpc:` 사용, 앱은 SQL 로그인 |

DB 접속 설정 (`api/src/db/pool.js`):
- `server: '127.0.0.1', port: 1433` (`localhost`는 `::1` 우선 해석 시 지연 가능, instanceName 사용 안 함), `options.encrypt: true, trustServerCertificate: true` (로컬 자체서명 인증서)
- `options.useUTC: false` — 모든 일시는 **KST 로컬 시각**으로 저장·조회 (기본값 true면 date 컬럼이 9시간 밀림)
- 문자열 파라미터는 `sql.NVarChar` 명시
- sqlcmd로 스키마를 실행할 때는 `-I`(QUOTED_IDENTIFIER ON) 필수 — 필터 인덱스 생성 조건. Node 드라이버는 기본 ON.

DB 권한:
- `aptlog_{env}_app` → 역할 `aptlog_app_role` (002_app_role.sql): dbo 스키마 CRUD + EXECUTE, 단 `snapshot`·`snapshot_value`·`snapshot_void`·`commute`는 `DENY UPDATE, DELETE`, `schema_version`은 읽기 전용 (tempdb에서 거부 동작 검증 완료)
- `aptlog_{env}_mig` → `db_owner`. 마이그레이션 러너 전용
- `HH_*` 접근은 §4.4의 계약 뷰/시노님 범위로 한정

### 2.2 기술 스택 (npm registry 2026-10-31 조회 버전)

| 영역 | 패키지 | 버전 | 비고 |
|---|---|---|---|
| 프론트 | vue | 3.5.44 | |
| | vite | 8.3.5 | |
| | pinia | 4.1.0 | 선택 상태·캐시 |
| | vue-router | 5.4.0 | |
| | echarts / vue-echarts | 6.1.0 / 8.3.2 | `echarts/core` 모듈 단위 import |
| | primevue (선택) | 5.0.4 | MIT, 그리드·폼 UI. DevExtreme 대체 |
| 백엔드 | express | 5.3.0 | |
| | mssql | 12.7.13 | |
| | multer | 2.5.0 | 업로드 |
| | sharp | 0.35.5 | 썸네일 webp |
| | exifr | 7.1.3 | 촬영일·GPS 추출 |
| | node-cron | 4.6.0 | 월 배치 |
| | zod | 4.6.7 | 요청·외부 응답 검증 |
| | @turf/turf | 7.4.0 | bbox·거리 계산(서버/빌드) |
| 빌드(geo) | mapshaper | 0.7.101 | 행정동 → 시군구 dissolve·토폴로지 보존 단순화 (devDependency) |
| 런타임 | Node.js | 24.x LTS | 로컬 실측 v24.15.0. vite 8 엔진 조건(`^20.19 \|\| >=22.12`) 충족 |

**메이저 버전 주의**: Vite 8(Rolldown 기반 번들러), Pinia 4, vue-router 5, Express 5, zod 4는 모두 최근 메이저 변경. 인터넷 예제·기존 지식이 구버전 기준일 수 있으므로 **각 공식 마이그레이션 가이드를 확인 후 사용**하고, 확인한 API 차이는 이 문서 §2.2에 메모로 남긴다.

**UI 라이브러리 주의**: DevExtreme은 개발자 1인당 라이선스. 회사 구독을 개인 프로젝트에 쓰면 EULA 위반 소지(추정, 계약서 확인 필요). 기본은 PrimeVue + ECharts, 차트·그리드는 래퍼 컴포넌트로 감싸 교체 가능하게.

### 2.3 디렉터리 구조

```
aptlog/
├─ CLAUDE.md                  # Claude Code 작업 규칙
├─ APTLOG_DEV_PLAN.md         # 이 문서
├─ .env.example
├─ db/
│  ├─ migrations/             # 001_init.sql, 002_..., 번호 순 실행
│  ├─ seed/                   # field_def, enum_def, anchor 초기 데이터
│  └─ run-migrations.js       # schema_version 테이블 기반 러너
├─ api/
│  ├─ src/
│  │  ├─ app.js               # Express 앱, 정적 서빙, 에러 핸들러
│  │  ├─ config.js            # .env 로드 + zod 검증
│  │  ├─ db/pool.js
│  │  ├─ routes/              # regions, complexes, snapshots, compare, media, sync, settings, export
│  │  ├─ services/            # ComplexService, SnapshotService, DiffService, CompareService, MediaService
│  │  ├─ external/            # quota.js(쿼터 가드), kapt.js, bldHub.js, rtms.js, rtmsRent.js, kakaoTransit.js, naverGeocode.js
│  │  ├─ jobs/                # monthlyTrade.js, masterRevalidate.js
│  │  └─ util/                # haversine, hash, unit(억/만원 변환)
│  └─ test/
├─ web/
│  ├─ src/
│  │  ├─ map/                 # MapAdapter 인터페이스 + NaverMapAdapter (+ KakaoMapAdapter 예비)
│  │  ├─ components/          # SidePanelSummary, SidePanelCompare, DetailModal, SnapshotForm, charts/*
│  │  ├─ stores/              # selection, complexes, settings
│  │  └─ views/
│  └─ public/geo/             # 시군구 GeoJSON (빌드 산출물)
├─ geo/
│  └─ build-boundaries.js     # admdongkor → mapshaper 시군구 dissolve → 단순화 → 구별 분할 + 시(일반구 합산) 파일 사전 생성
└─ scripts/
   ├─ backup.ps1              # DB 백업 + 미디어 증분 복사
   └─ install-service.ps1
```

---

## 3. 입력 항목 정의 (첨부 임장 보고서 기준)

첨부 양식 구조: **기본정보 → 가치평가(교통·환경·학군 + S/A/B/C 등급) → 가격 → 부문별 결론 → 단지 비교표 + 비교평가 결론**

### 3.1 데이터 3계층

| 계층 | 의미 | 입력 주체 | 저장 |
|---|---|---|---|
| A. 불변(마스터) | 위치, 연식, 세대수, 복도유형, 용적률 등 | 공공 API 자동 | `master_revision` (리비전 관리) |
| B. 준정적 | 교통 소요시간, 학교 배정, 학원가, 편의시설, 정비사업 단계 | 내가 입력 (직전 값 자동 복사) | 스냅샷 필드 / 전용 테이블 |
| C. 시계열 | 호가, 실거래, 전세, 등급, 결론, 사진 | 내가 입력 + 자동 고정 | `snapshot` + `snapshot_value` |

### 3.2 필드 매핑 (전체)

| # | 문서 항목 | 예시 | 계층 | 출처 | 저장 위치 |
|---|---|---|---|---|---|
| 1 | 위치(구/동) | 관악구 봉천동 | 불변 | K-apt 법정동코드 | `complex` |
| 2 | 연식 | 2005년식 | 불변 | K-apt 사용승인일 | `master_revision` |
| 3 | 세대수 | 2105세대 | 불변 | K-apt / 건축HUB | `master_revision` |
| 4 | 복도·계단식 | 복도식 | 불변 | K-apt 복도유형 | `master_revision` |
| 5 | 평형·방/화 | 23평, 방3화2 | 불변(평형별) | 실거래 전용면적 + 수동 | `area_type` |
| 6 | 기준점 직선거리 | 강남역 7.3km | 계산 | 핀 좌표 ↔ 기준점 (haversine) | 저장 안 함 |
| 7 | 업무지구·직장 소요시간·환승 | 34분, 버스 1회 환승 | 준정적 | 카카오 대중교통 제안 → 확정 | `commute` |
| 8 | 유해시설(반경 3km) | 없음 | 준정적 | 수동 | 필드 `env_hazard` (bool) + 메모 |
| 9 | 편의시설 | 백화점1, 대형마트0, 종합병원1 | 준정적 | 수동 | 필드 `env_dept`, `env_mart`, `env_hospital` |
| 10 | 배정 중학교·학업성취도 | 구암중 82% | 준정적(연 1회) | 수동 | `school`, `school_stat`, `complex_school` |
| 11 | 통학 시간 | 도보 20분 / 버스 20분 | 준정적 | 수동 | `complex_school` |
| 12 | 학원가 수 | 봉천동 38개 | 준정적 | 수동 (같은 법정동 단지 값 prefill) | 필드 `edu_academy_cnt` |
| 13 | 최근접 역·도보시간 | 2호선, 도보 n분 | 준정적 | 수동 | 필드 `trn_station`, `trn_station_walk_min` |
| 14 | 교통 등급 | S | 시계열 | 수동 | 필드 `grade_traffic` (enum) |
| 15 | 환경 등급 | A | 시계열 | 수동 | 필드 `grade_env` (enum) |
| 16 | 학군 등급 | C | 시계열 | 수동 | 필드 `grade_edu` (enum) |
| 17 | 현재 호가 | 10.7억 | 시계열(평형별) | 수동 (네이버 부동산 보고 입력) | 필드 `price_ask` |
| 18 | 최근 실거래 | (26.08) 11.3억 | 시계열(평형별) | 실거래 API 자동, 스냅샷 시점에 고정 (수동 override 가능) | 필드 `price_last_trade`, `price_last_trade_ym` + `trade` |
| 19 | 전세가·갭·전세가율 | 4억 / 7.075억 / 36.1% | 시계열(평형별) | 전월세 실거래 자동 + 계산 | `trade_rent` + 뷰 |
| 20 | 호가 괴리율 | 벽산 −5.3%, 두산 +2.4% | 계산 | (호가−실거래)/실거래 | 뷰 |
| 21 | 예산 대비 | +0.7억 | 계산 | 호가 − 내 예산(설정 또는 가계 시스템) | 뷰 |
| 22 | 부문별 결론 | 교통/학군/환경 서술 | 시계열 | 수동 | 필드 `note_traffic`, `note_edu`, `note_env` |
| 23 | 종합 및 느낀점 | 서술 | 시계열 | 수동 | 필드 `note_overall` |
| 24 | 태그 | 언덕, 대단지, 역세권 | 준정적 | 수동 | `complex_tag` |
| 25 | 시세 그래프 캡처 | 호갱노노 캡처 | 시계열 | 업로드 (자동 차트로 대체 가능) | `media` (kind=PRICE_CAPTURE) |
| 26 | 임장 사진 | 사진 | 시계열 | 업로드 | `media` (kind=PHOTO) |
| 27 | 위치 지도 캡처 | 이미지 | — | 불필요 (실제 지도로 대체), 업로드는 허용 | `media` (kind=MAP_CAPTURE) |
| 28 | 단지 비교표 | 표 | 비교 단위 | 자동 생성 | `comparison_item` |
| 29 | 비교평가 결론 | 서술 | 비교 단위 | 수동 | `comparison.conclusion` |
| 30 | 정비사업 단계 | 안전진단/조합설립 등 | 준정적 | 수동 (국토부 CSV 참고값 표시) | 필드 `redev_stage` (enum) |

### 3.3 기준점(anchor) 초기값

양식의 "강남역 / 시청역 / 여의도역 / 나와 배우자 직장" → 설정 화면에서 편집 가능한 데이터로 관리 (하드코딩 금지).

| name | kind | 비고 |
|---|---|---|
| 강남역 | 업무지구 | 직선거리 기준점 |
| 시청역 | 업무지구 | |
| 여의도역 | 업무지구 | |
| 내 직장 | 직장 | 좌표는 설정에서 입력 |
| 배우자 직장 | 직장 | 좌표는 설정에서 입력 |

### 3.4 등급 enum

| code | label | ord |
|---|---|---|
| S | 최상 | 4 |
| A | 좋음 | 3 |
| B | 보통 | 2 |
| C | 미흡 | 1 |

---

## 4. 데이터베이스 설계

### 4.1 테이블 목록

| 테이블 | 설명 |
|---|---|
| `schema_version` | 마이그레이션 이력 |
| `region` | 시군구 (`sigungu_cd` char(5) PK, sido_nm, sgg_nm, city_nm(상위 시), bbox, valid_from, valid_to) — **법정동 코드(LAWD_CD) 기준** |
| `region_code_map` | 코드 대응·이력 (lawd_cd, adm_cd(경계 데이터 행정 코드), prev_lawd_cd, valid_from, valid_to, memo) — 2026-02 화성시 일반구 신설, 2026-07 인천 개편 등 행정구역 변경 대응 |
| `complex` | 추적 단지 (`complex_id`, display_nm, sigungu_cd, bjd_cd, lat, lng(내가 찍은 핀), status, created_at) |
| `complex_ext_id` | 외부 코드 (source: KAPT / RTMS_APTSEQ / BLD, ext_id, valid_from, valid_to) — 재건축 후 코드 교체 대응 |
| `master_revision` | 불변 정보 리비전 (status: CURRENT / PENDING / REJECTED / SUPERSEDED, use_apr_day, hhld_cnt, dong_cnt, max_floor, builder, heat_type, hall_type, far_ratio, bc_ratio, plat_area, park_cnt, raw_json, payload_hash, fetched_at, decided_at) |
| `area_type` | 평형 (label '23평', excl_m2, supply_m2, rooms, baths, hhld_cnt, is_primary) |
| `field_def` | 필드 메타 (field_cd PK, label, category, data_type num/text/date/bool/enum, unit, scope COMPLEX/AREA, diff_mode ABS/PCT/BOTH/NONE, better UP/DOWN/NONE, carry_forward bool, confirm_on_carry bool(복사값 그대로 저장 시 확인 안내 — 호가·등급), sort, active) |
| `enum_def` | enum 값 (field_cd, code, label, ord) |
| `snapshot` | 스냅샷 헤더 (complex_id, observed_at date, input_at datetime2, source 임장/온라인/중개사, master_rev_id, supersedes_id, memo) — `is_void` 컬럼 없음 |
| `snapshot_void` | 무효화 기록 (snapshot_id PK, voided_at, reason, replaced_by_snapshot_id NULL) — 정정·단순 무효 모두 INSERT로 처리 |
| `snapshot_value` | 값 (value_id PK, snapshot_id, field_cd, area_type_id NULL=단지 단위, num_val dec(18,4), text_val nvarchar(4000), date_val, carried_from_value_id NULL, UNIQUE(snapshot_id, field_cd, area_type_id)) — 호가는 **평형 단위 1개 값** (매물 단위는 A8 참조) |
| `anchor` | 기준점 (name, lat, lng, kind, sort) |
| `commute` | 소요시간 (snapshot_id, anchor_id, minutes, mode, transfers, route_desc, suggested_minutes) |
| `school` / `school_stat` / `complex_school` | 학교, 연도별 성취도(metric_desc 포함), 단지별 배정 이력·통학시간 |
| `complex_tag` | 태그 |
| `media` | 사진·캡처 (complex_id, snapshot_id NULL, kind, rel_path, thumb_path, sha256 UNIQUE, mime, w, h, taken_at, caption) |
| `trade` | 매매 실거래 (complex_id, apt_seq, deal_date, excl_m2, floor, dong, amount_man, cancel_flag, cancel_date, dup_seq, natural_key_hash, UNIQUE(natural_key_hash, dup_seq), first_seen_at, last_seen_at) |
| `trade_rent` | 전월세 실거래 (deposit_man, monthly_man, contract_type, 동일한 natural_key_hash + dup_seq 방식) |
| `api_quota` | 외부 API 호출 카운터 (api_cd, period_type DAY/MONTH, period_key, call_cnt, limit_cnt, PK(api_cd, period_type, period_key)) |
| `redev_ref` | 국토부 정비사업 통합 CSV 적재 (기준연도, 시도, 시군구, 구역명칭, 추진단계, 사업유형, 시행자, 공급예정세대) |
| `comparison` / `comparison_item` | 비교 기록 (as_of, title, conclusion / complex_id, snapshot_id, area_type_id, sort) |
| `sync_log` | 외부 API 호출 결과·오류 로그 |
| `setting` | 키-값 설정 (예산, 지도 엔진, 미디어 base path 등) |

### 4.2 설계 규칙

- 금액 단위: **만원 정수**로 저장 (10.7억 = 107000). 화면에서 억 단위 변환.
- `snapshot_value.area_type_id`가 NULL이면 단지 단위 값. SQL Server UNIQUE 제약은 NULL을 같은 값으로 보므로 `(snapshot, field, NULL)` 중복 방지가 그대로 동작.
- 일시: `observed_at`은 `date`(관측일), `input_at`·`fetched_at` 등은 `datetime2` **KST 로컬 시각**. mssql `useUTC: false` (§2.1.1).
- **스냅샷 불변(예외 없음)**: `snapshot`·`snapshot_value`는 INSERT만 허용, `aptlog_app`에 `DENY UPDATE, DELETE`로 DB 차원에서 강제.
  - 정정: 정정본을 새로 만들고 `supersedes_id` = 원본, 같은 트랜잭션에서 `snapshot_void(원본, replaced_by=정정본)` INSERT. 정정본의 `observed_at`은 원본 값을 기본으로 복사(사용자 수정 가능).
  - 단순 무효(잘못 입력): `snapshot_void(replaced_by=NULL)` INSERT.
  - 유효 스냅샷 = `snapshot_void`에 없는 스냅샷 → 뷰 `v_snapshot_active`로 제공, 조회·증감·비교는 모두 이 뷰 기준.
- **carry_forward 값 구분**: 직전 값 자동 복사로 저장된 값은 `carried_from_value_id`에 원본 value_id를 기록(체인이면 최초 원본까지 따라가 기록). 사용자가 값을 수정하면 NULL(=이번에 실제 관측).
  - **실효 관측일**(`eff_observed_at`) = 복사값이면 원본 값이 속한 스냅샷의 `observed_at`, 아니면 자기 스냅샷의 `observed_at`. 뷰 `v_snapshot_value_eff`로 제공.
  - 증감 계산은 **실제 관측값끼리만** 비교(복사값 제외) → 복사로 인한 가짜 0 증감 방지.
  - "30일 초과 흐림"·비교 화면 관측일 표시는 `eff_observed_at` 기준.
- 스냅샷은 생성 시점의 `master_rev_id`를 저장 → 당시 단지 정보 재현 가능.
- 최근 실거래는 스냅샷 생성 시 `trade`에서 **`deal_date <= observed_at` 조건으로** 조회해 **값으로 고정**(과거 날짜로 입력한 스냅샷에도 당시 기준 실거래가 붙도록. 이후 실거래 정정과 무관하게 당시 판단 근거 보존). 해제 건(`cancel_flag=1`) 제외.
- `trade`·`trade_rent`·`master_revision` 등 외부 수집 테이블은 스냅샷이 아니므로 UPDATE 허용(해제 반영, `last_seen_at` 갱신 등).
- 실거래 중복 제거:
  - `natural_key_hash` = sha256(apt_seq, deal_date, excl_m2, floor, dong, amount_man) — **해제 여부·해제일은 제외**. 같은 거래가 나중에 해제되면 새 행이 아니라 기존 행 UPDATE.
  - 같은 키의 정상 거래가 같은 응답 안에 여러 건이면 `dup_seq` 1, 2, …로 구분(같은 날·층·가격 거래가 하나로 합쳐지지 않도록). 재수집 시 같은 응답 내 동일 키 건수를 기준으로 upsert.
- 평형 매칭: 실거래 `excl_m2` → `area_type.excl_m2`와 **±0.5㎡ 이내**면 같은 평형(허용 오차는 `setting.area_match_tolerance_m2`). 둘 이상 해당하면 가장 가까운 값, 해당 없으면 미매칭 목록으로 표시해 수동 지정.
- 인덱스: `snapshot(complex_id, observed_at)`, `snapshot_value(field_cd, area_type_id) INCLUDE(num_val)`, `trade(complex_id, deal_date)`.
- 신규 DB 호환성 수준 170(SQL Server 2025 기본). `WINDOW` 절은 160 이상 필요 → `001_init.sql`에서 확인.

### 4.3 변경분 뷰 (SQL Server 2025 `WINDOW` 절 — 버전 확인 완료, 쿼리 자체는 P2에서 검증)

```sql
CREATE OR ALTER VIEW dbo.v_snapshot_active AS
SELECT s.*
FROM dbo.snapshot s
WHERE NOT EXISTS (SELECT 1 FROM dbo.snapshot_void x WHERE x.snapshot_id = s.snapshot_id);
GO

CREATE OR ALTER VIEW dbo.v_snapshot_diff AS
WITH v AS (
    SELECT s.complex_id, s.snapshot_id, s.observed_at,
           sv.field_cd, sv.area_type_id, sv.num_val,
           LAG(sv.num_val)    OVER w AS prev_val,
           LAG(s.observed_at) OVER w AS prev_at
    FROM dbo.v_snapshot_active s
    JOIN dbo.snapshot_value sv ON sv.snapshot_id = s.snapshot_id
    WHERE sv.num_val IS NOT NULL
      AND sv.carried_from_value_id IS NULL      -- 실제 관측값끼리만 비교
    WINDOW w AS (PARTITION BY s.complex_id, sv.field_cd, sv.area_type_id
                 ORDER BY s.observed_at, s.snapshot_id)
)
SELECT complex_id, snapshot_id, observed_at, field_cd, area_type_id,
       num_val, prev_val, prev_at,
       num_val - prev_val AS delta,
       CASE WHEN prev_val IS NULL OR prev_val = 0 THEN NULL
            ELSE (num_val - prev_val) * 100.0 / prev_val END AS delta_pct
FROM v;
```

- `v_snapshot_value_eff`: 유효 스냅샷의 값 + `eff_observed_at`(복사값은 원본 관측일) + `is_carried`.
- 텍스트·enum 필드 변경 감지는 별도 뷰 `v_snapshot_text_diff` (실제 관측값 기준, 직전 값과 다르면 changed=1).
- 단지 간 기준일 비교: `OUTER APPLY (SELECT TOP 1 ... FROM v_snapshot_value_eff WHERE observed_at <= @asOf ORDER BY observed_at DESC)`. **각 값의 `eff_observed_at`을 함께 반환**하고 30일 초과 값은 화면에서 흐리게 표시.

### 4.4 가계 시스템 연동 (DEV/PROD 분리)

| AptLog DB | 연동 대상 | 방향 |
|---|---|---|
| `RealtyLog_DEV` | `HH_DEV` | 양방향 (아래) |
| `RealtyLog_PROD` | `HH_PROD` | 양방향 (아래) |

- **AptLog → 가계**: 계약 뷰 `RealtyLog_*.dbo.v_complex_latest` (단지·대표 평형별 최신 호가·실거래·`eff_observed_at`). 가계 시스템은 이 뷰만 읽는다.
- **가계 → AptLog** (A6 예산): 가계 DB 쪽 계약 뷰(예: 최대 매수 가능액)를 AptLog에서 **시노님**으로 참조. 뷰 이름은 가계 시스템과 합의 후 확정(U14).
- 상대 DB 이름은 뷰·코드에 직접 쓰지 않는다. 마이그레이션에서 `CREATE SYNONYM dbo.hh_budget FOR [$(HH_DB)].dbo.<계약뷰>` 형태로 만들고, `HH_DB`는 sqlcmd 변수(DEV/PROD별)로 주입.
- 계약 뷰의 컬럼 변경은 양쪽 합의 후에만. 변경 시 이 절에 버전 기록.

---

## 5. 외부 연동

### 5.1 API 목록

| 용도 | API | 엔드포인트/비고 | 무료 한도 |
|---|---|---|---|
| 단지 목록(시군구별) | 국토교통부_공동주택 단지 목록제공 서비스 | 오퍼레이션명·버전 **활용신청 후 Swagger 확인 필요** | 개발계정 |
| 단지 기본·상세 | 국토교통부_공동주택 기본 정보제공 서비스 | `apis.data.go.kr/1613000/AptBasisInfoServiceV4` (상세: `getAphusDtlInfoV4`) | 개발계정 5,000/일 |
| 건축물대장 표제부 | 건축HUB 건축물대장정보 서비스 | `apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo` (+총괄표제부) | — |
| 매매 실거래 | 아파트 매매 실거래가 상세 자료 | `apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev`, LAWD_CD(5)+DEAL_YMD, numOfRows ≤1000 | 개발계정 10,000/일 |
| 전월세 실거래 | 아파트 전월세 실거래가 자료 (15126474) | 엔드포인트 활용신청 후 확인 | — |
| 지도 | 네이버 Maps Web Dynamic Map | `ncpKeyId` 파라미터 (구 `ncpClientId` 아님) | 대표 계정 월 6,000,000건 |
| 지오코딩 | 네이버 Maps Geocoding | 서버에서 호출 (Client Secret 보호) | 월 3,000,000건 |
| 대중교통 소요시간 | 카카오 대중교통 경로 조회 (2026-07-21 신설) | 제안값 용도 | 일 1,000건, **초과 10원/건 (유료)** → 서버 쿼터 가드 필수 |
| 정비사업 | 국토교통부_전국 도시정비사업 통합 데이터 (15160169) | CSV, 연 1회 갱신 | 무료 |
| 행정경계 | vuski/admdongkor `ver20260701` | 2026-02 화성시 일반구 신설, 2026-07 인천·전남광주 개편 반영 | — |

### 5.2 지도 비용·정책 체크리스트

- [ ] NCP 콘솔에서 **신규 "Maps" 상품**으로 신청 (구 AI·NAVER API 지도는 무료 이용량 종료)
- [ ] 로그인 계정이 **대표 계정**인지 확인 (대표 계정만 무료)
- [ ] Web 서비스 URL에 `http://localhost:{포트}` (및 필요 시 내부 IP) 등록
- [ ] **일/월 이용 한도 설정** (예: 일 2,000, 월 30,000) + 70% 알림 → 과금 원천 차단
- [ ] 카카오 앱은 계정의 **첫 번째 활성 앱**으로 만들어야 무료 쿼터 적용
- [ ] A9 모바일 접속 시 Web 서비스 URL에 PC 내부 IP(`http://192.168.x.x:{포트}`) 추가 등록 (DHCP 예약으로 IP 고정)
- [ ] **P0 착수 시 바로 신청**: 공공데이터포털 활용신청(K-apt 단지목록·기본정보, 건축HUB, 매매·전월세 실거래), NCP Maps, 카카오 앱 — 일부는 승인에 시간이 걸리고 U1·U3 확인이 P1 등록 기능의 선행 조건

### 5.2.1 서버 쿼터 가드 (콘솔 한도와 별개로 이중 차단)

- 모든 외부 호출은 `external/quota.js`를 거친다: 호출 **전에** `api_quota` 카운터를 원자적으로 증가(`UPDATE ... SET call_cnt = call_cnt + 1 OUTPUT inserted.call_cnt`) → 한도 초과면 호출하지 않고 `QUOTA_EXCEEDED` 에러.
- 기본 한도 (`setting`에서 조정, 무료 한도보다 낮게):

| api_cd | 일 한도 | 월 한도 | 근거 |
|---|---|---|---|
| KAKAO_TRANSIT | 800 | — | 무료 1,000/일, 초과 유료 |
| NCP_GEOCODE | 2,000 | 50,000 | 무료 3,000,000/월 |
| DATA_GO_KR_* (API별) | 무료 한도의 80% | — | 개발계정 한도 |

- 지도 SDK 로딩·타일은 브라우저에서 직접 호출되어 서버가 셀 수 없음 → NCP 콘솔 한도 설정(§5.2)으로만 차단.
- 한도 70% 도달 시 설정 화면·첫 화면에 경고 표시.

### 5.3 데이터 정책 원칙

- 지오코딩 결과는 **지도 이동용**. 저장 좌표는 **내가 찍은 핀** (vworld 지오코더는 결과 DB 저장 금지 명시, 카카오 로컬도 원문 저장 제한).
- 카카오 대중교통 결과도 **제안값**으로 표시하고, 저장은 내가 확정한 분·환승 값 (`suggested_minutes`는 참고 기록).
- 네이버 부동산·호갱노노 **크롤링 금지** (약관·차단 위험). 호가는 수동 입력.

### 5.4 단지 등록 흐름

1. 지도에서 구 선택 → `sigungu_cd` 확보
2. "단지 추가" → 해당 구 K-apt 단지 목록(DB 캐시, 없으면 조회 후 캐시)에서 자동완성 → `kaptCode`
3. K-apt 기본·상세 조회 → 사용승인일, 세대수, 동수, 난방, 시공사, 복도유형, 법정동코드, 지번주소
4. 법정동코드 + 지번 → 건축HUB 표제부·총괄표제부 → 용적률, 건폐율, 대지면적, 최고층, 주차
5. 실거래 최근 36개월 (LAWD_CD=시군구) → 지번 일치 aptSeq 후보 제시 → 내가 확정. 거래 전용면적 고유값(±0.5㎡ 묶음)으로 `area_type` 후보 생성 → 평형 라벨·방/화 입력
   - 조회 기간 중 행정구역이 바뀐 지역은 `region_code_map`으로 **해당 월에 유효했던 코드(옛 코드 포함)**를 모두 조회.
   - 응답 `totalCount` 기준으로 **모든 페이지 조회**(numOfRows 1000 페이징). 한 달 1,000건 초과 구 대비.
6. 전월세 실거래 동일 기간 수집
7. 지오코딩으로 지도 이동 → **내가 핀 확정** → lat/lng 저장
8. `master_revision` #1 = CURRENT
9. K-apt 미가입(소규모) 단지: 건축HUB + 수동 입력 경로 제공

### 5.5 배치

| 작업 | 주기 | 내용 |
|---|---|---|
| 실거래 수집 | 월 1회 + 수동 실행 | 추적 단지 시군구별 **최근 2~3개월 재수집** (신고 지연·해제 반영), 전 페이지 조회, `natural_key_hash`+`dup_seq` upsert (§4.2), 해제 건은 기존 행 `cancel_flag`·`cancel_date` UPDATE |
| 마스터 재검증 | 월 1회 + 스냅샷 입력 화면 진입 시 | payload_hash 비교 → 다르면 PENDING 리비전 생성 |
| 정비사업 CSV | 연 1회 수동 | `redev_ref` 적재, 구역명칭 ↔ 단지 수동 링크 |
| 백업 | 일 1회 (작업 스케줄러) | §8 참조 |

모든 외부 호출: 쿼터 가드(§5.2.1) 통과 후 호출, 타임아웃 10초, 재시도 2회(지수 백오프, 재시도도 쿼터에 포함), 결과는 `sync_log` 기록. 실패해도 기존 데이터로 화면 정상 동작.

---

## 6. 재건축·재개발 변경 감지

1. 동기화 결과 payload_hash ≠ CURRENT → `master_revision` PENDING 생성.
2. 스냅샷 입력 화면 상단 배너 **"단지 정보 변경 감지"** → 표(필드 / 현재 / 신규) + [반영] [무시].
   - 반영: 기존 CURRENT → SUPERSEDED, PENDING → CURRENT.
   - 무시: REJECTED (같은 hash는 다시 묻지 않음).
3. 재건축 준공으로 `kaptCode`가 바뀌는 경우(추정): 기존 코드 조회 실패 또는 세대수 ±30% 이상 변화 시 **"후속 단지 연결"** 화면 → 기존 `complex_ext_id.valid_to` 마감, 새 코드 등록. `complex_id`는 유지 → 이력 연속.
4. 정비사업 단계는 스냅샷 enum 필드 `redev_stage`로 기록, `redev_ref` 값은 참고 표시. 단계 변경 시점은 상세 팝업 **정비 타임라인**으로 표시.

`redev_stage` enum 예시: 해당없음 / 추진준비 / 안전진단 / 정비구역지정 / 추진위 / 조합설립 / 사업시행인가 / 관리처분인가 / 이주·철거 / 착공 / 준공

---

## 7. 화면 설계

### 7.1 메인 (지도)

- 상단: 구/시 검색 자동완성, 상태 필터(§10 파이프라인), 태그 필터, "단지 추가" 버튼
- **구 선택**: `fitBounds(bbox, 여백)` + 마스크 폴리곤 1개 (바깥=전국 사각형 시계방향, 구멍=선택 구 경계 반시계방향). 다중 조각 구는 조각마다 구멍. "성남시" 같은 시 검색은 하위 구 합친 영역 — **빌드 단계에서 시 단위 파일을 미리 생성**(브라우저에서 union 계산 금지).
  - 100ms 목표는 "선택 → fitBounds 호출 + 마스크 렌더 완료" 기준(지도 타일 로딩 시간 제외).
  - 단순화한 경계와 네이버 베이스맵 경계선이 수 m 어긋날 수 있음(표시용으로 허용).
- **마커**: HTML 말풍선 — 단지명, 대표 평형 최근 호가, 직전 대비 ▲/▼, 상태 색. 선택 구 밖 마커는 투명도 0.35.
  - 클러스터링은 **보류**(개인 사용 규모상 200개 초과 가능성 낮음). 필요 시 네이버 공식 예제 `MarkerClustering.js`를 `web/src/map/vendor/`에 복사해 사용(npm 모듈 아님).
- **지도 엔진**: `MapAdapter` 인터페이스 (`fitBounds`, `setMask`, `addMarker`, `onMarkerClick`, `setCenter`) → NaverMapAdapter 기본, KakaoMapAdapter 예비.
- GL(벡터) 모드 `gl: true` + `submodules=gl`은 P1 스파이크에서 폴리곤 구멍·HTML 마커 동작 확인 후 결정 (다른 서브모듈과 비호환, 저사양 GPU에서 느려질 수 있음).

### 7.2 선택 상태 (Pinia `selection.selectedIds`)

| 선택 수 | 우측 패널 (~420px) |
|---|---|
| 0 | 닫힘 |
| 1 | **요약**: 마스터 핵심(연식·세대수·복도유형·용적률), 등급 3종 배지, 대표 평형 호가·실거래·괴리율·예산 대비, 직전 대비 증감, 호가 스파크라인, 최근 스냅샷 일자, [상세] [새 스냅샷] |
| 2~4 | **비교**: 첨부 양식 비교표 레이아웃 재현 (기본정보 / 교통 등급+세부 / 환경 / 학군 / 호가 / 최근 실거래 / 괴리율 / 예산 대비), `field_def.better` 기준 최고·최저 강조, 관측일 표시(30일 초과 흐림), [상세 비교] [비교 기록 저장] |

- 다중 선택: Ctrl+클릭 또는 "비교 담기" 토글. 최대 4개.

### 7.3 상세 팝업 (95vw × 95vh)

**단일 단지 탭**
1. 개요: 마스터 정보 + 리비전 변경 이력, 위치 미니맵, 태그, 기준점 직선거리
2. 시세 추이: 내가 기록한 호가(라인) + 매매 실거래(산점도) + 전세 실거래(라인) + 전세가율(보조축) — 호갱노노 캡처 대체
3. 스냅샷 이력: 타임라인 + 필드별 증감표 (변경된 항목만 하이라이트)
4. 가치평가: 교통(기준점별 소요시간 표·차트), 환경, 학군(학교·성취도 연도별), 등급 추이
5. 실거래: 평형별 거래 목록, 해제 건 표시
6. 사진: 갤러리 (스냅샷별 그룹, EXIF 촬영일)
7. 정비 타임라인
8. 메모·결론: 부문별 결론, 종합 이력

**다중 단지**
- 지표 겹친 라인 차트(평형 선택), 기준일 바 차트, 등급 레이더 차트, 변경분 행렬, 비교 결론 입력.

### 7.4 스냅샷 입력 폼

- `field_def` 기반 동적 렌더링, 순서는 양식과 동일: 기본정보(읽기 전용) → 교통 → 환경 → 학군 → 가격 → 결론 → 사진.
- **직전 스냅샷 값 자동 복사(carry_forward)** → 바뀐 것만 수정. 변경된 필드는 입력 중 표시.
  - 복사된 값은 "복사됨 · 원 관측일 yyyy-mm-dd" 배지 표시. 수정하거나 [이번에 확인함] 체크 시 실제 관측값으로 저장(`carried_from_value_id = NULL`).
  - 가격(호가)·등급은 기본적으로 매번 확인 대상 → 복사값 그대로 저장 시 저장 전 확인 안내.
- 과거 날짜 입력(관측일 ≠ 오늘) 허용: 최근 실거래 자동 채움은 관측일 기준(§4.2).
- 교통: 기준점별 행, [소요시간 제안] 버튼(카카오) → 제안값 표시 → 확정 입력.
- 가격: 평형별 호가 입력, 최근 실거래는 자동 채움(수정 가능), 괴리율·예산 대비 즉시 계산.
- 첫 등록 시 같은 법정동 다른 단지의 학원가·편의시설·학교 값 prefill.
- 저장 전 "단지 정보 변경 감지" 배너 처리.
- 금액 입력은 "10.7억", "107000", "10억7천" 모두 허용 → 만원 정수로 정규화.

### 7.5 설정 화면

- 기준점 편집(지도 클릭으로 좌표), 예산(또는 가계 시스템 연동 on/off), 지도 엔진 선택, API 키 상태 확인, **API 쿼터 사용량·한도**, 미디어 base path, 백업 실행·마지막 백업 시각.

---

## 8. 파일 저장·운영

- 경로: `{MEDIA_ROOT}\{complex_id}\{yyyyMM}\{uuid}.{ext}`, 썸네일 `{MEDIA_ROOT}\thumb\{uuid}.webp` (긴 변 480px)
- DB에는 상대 경로만. sha256 중복 업로드 차단. EXIF 촬영일 같은 날 스냅샷에 자동 연결 제안.
- 클립보드 붙여넣기(Ctrl+V)로 캡처 업로드 지원.
- 업로드 제한 (multer): 파일당 30MB, 요청당 20개, MIME 화이트리스트 `image/jpeg, image/png, image/webp, image/heic`(+ sharp로 실제 디코딩 성공 여부 재확인), 저장 파일명은 서버 생성 uuid만 사용(원본 파일명은 DB 메타로만 보관 → 경로 조작 차단).
- 키 관리: `.env`에 `DATA_GO_KR_KEY`, `NCP_KEY_ID`, `NCP_CLIENT_SECRET`, `KAKAO_REST_KEY`, `DB_SERVER`·`DB_PORT`(1433)·`DB_NAME`(`RealtyLog_DEV`/`_PROD`)·`DB_USER`·`DB_PASSWORD`, `HH_DB`(`HH_DEV`/`HH_PROD`), `MEDIA_ROOT`, `BACKUP_ROOT`, `HOST`, `PORT`, `API_TOKEN`(HOST≠127.0.0.1이면 필수). `ncpKeyId`만 프론트 노출(도메인 제한).
- 백업 (`scripts/backup.ps1`, 작업 스케줄러 일 1회 — Express엔 SQL Agent 없음):
  - `BACKUP_ROOT`는 **당분간 같은 디스크의 별도 폴더**(2026-11-01 결정, 예: `C:\AptLogBackup`). 디스크 고장에는 보호되지 않으므로 설정 화면에 "같은 디스크" 경고를 상시 표시하고, 외장 디스크·NAS·클라우드 확보 시 `BACKUP_ROOT`만 바꿔 이전(스크립트 수정 불필요하게 경로는 설정값으로만 사용).
  - SQL Server 서비스 계정 `NT Service\MSSQL$SQLEXPRESS`에 `BACKUP_ROOT\db` **쓰기 권한 부여** 필요(서비스 계정이 파일을 씀). 네트워크 경로는 서비스 계정이 접근 불가하므로 로컬 폴더에 백업 후 robocopy로 복사.
  - `sqlcmd`로 `BACKUP DATABASE RealtyLog_PROD TO DISK=... WITH INIT, CHECKSUM` (일자별 파일) + `RESTORE VERIFYONLY`
  - **보관 정리(유일한 자동 삭제 예외)**: `BACKUP_ROOT\db\RealtyLog_*_yyyyMMdd.bak` 패턴 파일 중 14일 경과분만 삭제. 다른 경로·패턴은 절대 삭제하지 않음. 삭제 목록은 로그로 남김.
  - 미디어: `robocopy {MEDIA_ROOT} {BACKUP_ROOT}\media /E /XO` — **`/MIR` 사용 금지** (원본 실수 삭제가 백업까지 전파). 미디어 백업은 정리하지 않음.
  - DB 백업과 미디어 복사 시점 차이로 고아 참조가 생길 수 있음 → 복원 후 `media` 행 대비 파일 존재 점검 스크립트 제공.
  - 복원 절차를 README에 문서화하고 P0에서 1회 실제 복원 테스트

---

## 9. API 명세 (REST)

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/regions?q=` | 시군구 검색 |
| GET | `/geo/sigungu/{code}.json` | 구 경계 (정적) |
| GET | `/api/complexes/summary` | 전체 단지 요약 (앱 시작 시 1회) |
| GET | `/api/complexes/:id` | 단지 상세 (마스터, 평형, 태그, 학교) |
| GET | `/api/external/kapt?sigungu=&q=` | K-apt 단지 자동완성 |
| POST | `/api/complexes` | kaptCode로 등록 (§5.4 수집 수행) |
| PATCH | `/api/complexes/:id` | 핀 좌표·상태·태그·표시명 |
| POST | `/api/complexes/:id/sync` | 마스터 재검증 → PENDING diff 반환 |
| POST | `/api/master-revisions/:id/accept` · `/reject` | 변경 반영/무시 |
| POST | `/api/complexes/:id/successor` | 후속 단지 연결 |
| GET | `/api/complexes/:id/snapshots` | 스냅샷 목록 |
| GET | `/api/complexes/:id/snapshots/draft` | 직전 값 복사된 입력 초안 |
| POST | `/api/complexes/:id/snapshots` | 스냅샷 생성 |
| POST | `/api/snapshots/:id/correct` | 정정본 생성 (+ `snapshot_void` INSERT, 한 트랜잭션) |
| POST | `/api/snapshots/:id/void` | 단순 무효화 (`snapshot_void` INSERT, 사유 필수) |
| GET | `/api/snapshots/:id/diff?base=prev` | 증감 |
| GET | `/api/complexes/:id/series?fields=&area=` | 차트용 시계열 |
| GET | `/api/complexes/:id/trades?area=&from=` | 매매·전월세 실거래 |
| GET | `/api/compare?ids=&asOf=&area=` | 기준일 비교 |
| POST | `/api/comparisons` · GET `/api/comparisons` | 비교 기록 저장·조회 |
| POST | `/api/commute/suggest` | 카카오 대중교통 제안값 |
| POST | `/api/media` (multipart) · GET `/media/:id` · `/media/:id/thumb` | 사진 |
| GET/PUT | `/api/settings`, `/api/anchors`, `/api/schools` | 설정·기준점·학교 |
| GET | `/api/quota` | 외부 API 쿼터 사용량·한도 |
| POST | `/api/jobs/:name/run` | 배치 수동 실행 |
| GET | `/api/export/report/:id` · `/api/export/comparison/:id` | 보고서 내보내기 (§10) |

공통: zod 검증, 에러 응답 `{ error: { code, message } }`, 금액은 만원 정수. `HOST`가 127.0.0.1이 아니면 모든 `/api/*`·`/media/*`에 `Authorization: Bearer {API_TOKEN}` 필요.

---

## 10. 추가 제안 기능 (원 요구사항 외)

| # | 기능 | 가치 | 단계 |
|---|---|---|---|
| A1 | **단지 상태 파이프라인**: 관심 → 임장 예정 → 임장 완료 → 매수 후보 → 보류/제외 | 갈아타기 의사결정 진행 관리, 지도 마커 색으로 표시 | P2 |
| A2 | **가중치 종합점수**: 교통·환경·학군·가격 매력도 가중치를 설정에서 조정 → 단지 순위 | 비교 결론의 정량 근거 | P3 |
| A3 | **호가 괴리·하락 플래그**: 호가가 최근 실거래 대비 −5% 이하, 또는 새 실거래가 직전보다 하락 시 강조 | "지금 가격이 괜찮은가" 판단 자동화 | P4 |
| A4 | **월 배치 리포트**: 추적 단지의 신규 실거래·변동 요약을 앱 첫 화면 카드로 | 놓친 변화 확인 | P4 |
| A5 | **임장 보고서 내보내기**: 첨부 양식 그대로 단지 보고서·비교표를 Word/PDF로 생성 | 기존 양식 산출물 유지 | P5 |
| A6 | **가계 시스템 예산 연동**: 시뮬레이터의 최대 매수 가능액을 `예산 대비`에 실시간 반영 | 예산 현실성 즉시 판단 | P5 |
| A7 | **임장 일정·캘린더**: 임장 예정일, 방문 기록을 캘린더로 | 임장 계획 관리 | P5 |
| A8 | **매물 단위 메모**: 동·층·향·특이사항별 매물 기록(같은 단지 여러 매물). **2026-11-01 결정: MVP는 평형 단위 호가만.** 도입 시 신규 마이그레이션으로 `listing` 테이블 + `snapshot_value.listing_id`(NULL=평형 단위) 추가 → 기존 값은 NULL로 그대로 유지되며, UNIQUE 제약·증감 뷰 PARTITION에 `listing_id` 추가 필요 | 호가가 매물마다 다른 현실 반영 | P3 이후 (재검토) |
| A9 | **모바일 현장 입력**: 같은 Wi-Fi에서 휴대폰으로 사진·호가 즉시 입력 (반응형 + 선택적 0.0.0.0 바인딩 + API 토큰 인증, §2.1) | 임장 현장에서 바로 기록 | P5 |
| A10 | **지역 단위 공유 값**: 학원가·편의시설을 법정동 단위로 관리해 한 번 수정 시 같은 동 단지에 제안 | 중복 입력 제거 | P3 |

---

## 11. 개발 단계 및 완료 기준

| 단계 | 범위 | 완료 기준 (Acceptance) |
|---|---|---|
| P0 기반 | **환경 준비**(1433 포트는 기존 설정 사용, `aptlog_{env}_app`/`_mig` 로그인, `RealtyLog_DEV`/`_PROD` 생성, `git init`), **외부 API 활용신청·키 발급**(§5.2), 리포 구조, `.env`, 마이그레이션 러너, `001_init.sql`(snapshot_void·region_code_map·api_quota 포함), DENY UPDATE/DELETE 권한, seed(field_def·enum_def·anchor·region_code_map), Express 골격(쿼터 가드 포함), 경계 GeoJSON 빌드(mapshaper), 백업 스크립트 | Node에서 `localhost:1433` 접속 성공, 마이그레이션 재실행 안전(idempotent), `aptlog_{env}_app`으로 snapshot UPDATE 시도 시 거부됨, 수도권 시군구 GeoJSON 합계 2MB 이하, 백업→복원 1회 성공 |
| P1 지도·등록 | NaverMapAdapter, 구 검색·fitBounds·마스킹, K-apt/건축HUB/실거래 연동 단지 등록(페이징·옛 코드 조회), 핀 확정, 마커 말풍선, GL 모드 스파이크 | 구 선택 100ms 이내(타일 로딩 제외), 단지 등록부터 지도 표시까지 동작, API 장애 시 등록 실패만 표시되고 지도 정상, 쿼터 초과 시 호출 차단 확인 |
| P2 스냅샷 (**MVP 완료**) | field_def 동적 폼, carry_forward(복사값 구분·실효 관측일), 금액 정규화, 요약 패널, 증감 뷰, 정정본·무효화, 상태 파이프라인(A1) | 첨부 양식 30개 항목 모두 입력 가능, 스냅샷 2회 입력 시 증감 표시, 복사값만 있는 필드는 증감 0이 아니라 "변동 없음(미확인)"으로 표시, 정정 후 원본이 목록·증감에서 제외 |
| P3 비교·상세 | 비교 패널, 95% 상세 팝업 전체 탭, ECharts(라인·바·레이더·산점도), 비교 기록, 가중치 점수(A2), 매물 메모(A8), 지역 공유 값(A10) | 4개 단지 기준일 비교, 첨부 비교표와 같은 레이아웃 재현 |
| P4 자동화 | 월 실거래 배치(매매·전월세), 마스터 변경 감지·후속 단지 연결, 사진 업로드·썸네일·EXIF, 괴리 플래그(A3), 월 리포트(A4) | 배치 무인 실행, 변경 감지 배너 동작, 사진 중복 차단 |
| P5 연동·확장 | 가계 시스템 `v_complex_latest` + 예산 연동(A6, 시노님), 정비사업 CSV, 보고서 내보내기(A5), 캘린더(A7), 모바일 입력(A9), 카카오 소요시간 제안 | 시뮬레이터에서 목표 단지 호가 조회, DEV↔PROD 전환 시 뷰 수정 없이 동작 |

- P3 이후 범위(A2·A8 UI·A10 등)는 P2 완료 후 실제 사용해 보고 우선순위를 다시 정한다.

---

## 12. 불확실·검증 필요 목록

| # | 항목 | 검증 방법 |
|---|---|---|
| U1 | K-apt 단지 목록 API 오퍼레이션명·버전 | 활용신청 후 Swagger |
| U2 | K-apt 기본정보 V4 응답 필드명(구버전 `kaptUsedate`, `codeHallNm` 등과 동일 여부) | 실제 호출 응답 확인 |
| U3 | 전월세 실거래 API 엔드포인트·필드명 | 활용신청 후 확인 |
| U4 | 재건축 준공 후 kaptCode 교체 여부 | 사례 단지 조회 |
| U5 | aptSeq ↔ kaptCode 공식 매핑 부재 (지번 매칭 + 수동 확정으로 설계) | — |
| U6 | 네이버 지도 이동·확대 시 과금 건수 산정 방식 (어느 쪽이든 무료 범위) | 콘솔 이용량 모니터링 |
| U7 | 네이버 GL 모드에서 폴리곤 구멍·HTML 마커 동작 | P1 스파이크 |
| U8 | NCP 가입 시 결제 수단 등록 필요 여부(추정) | 가입 시 확인 |
| U9 | 카카오 대중교통 결과 저장 약관 (제안→확정 방식으로 우회) | 약관 확인 |
| U10 | 학업성취도 "82%"의 지표 정의 | `school_stat.metric_desc`에 출처 기록 |
| U11 | 네이버 지오코딩 결과 저장 약관 (핀 확정 방식이라 영향 없음) | — |
| ~~U12~~ | ~~가계 시스템 SQL Server 버전~~ → **해결(2026-10-31)**: SQL Server 2025 RTM Express, `WINDOW` 절 사용 가능 | `SELECT @@VERSION` 실측 |
| U13 | DevExtreme 개인 사용 라이선스 | 계약서·EULA |
| U14 | 가계 시스템(`HH_*`) 쪽 예산 계약 뷰 이름·컬럼 | 가계 시스템 스키마 확인 후 합의 |
| U15 | 행정구역 개편 지역(인천 2026-07, 화성 2026-02)의 실거래·K-apt API가 쓰는 시군구 코드(신·구 코드 적용 시점) | 해당 지역 개편 전후 월 실제 조회 |
| U16 | 실거래 `excl_m2` 평형 매칭 허용 오차 ±0.5㎡의 적정성 | 추적 단지 실거래로 검증 후 `setting` 조정 |
| U17 | 같은 응답 내 동일 키 정상 거래(`dup_seq`)가 재수집 시 순서·건수가 안정적인지 | 같은 월 반복 조회 비교 |

---

## 13. 참고 출처 (2026-10-31 조회)

- NCP Maps 상품·요금: https://www.ncloud.com/product/applicationService/maps
- NCP Maps Application 가이드: https://guide.ncloud-docs.com/docs/maps-app
- 네이버 Maps 셰이프(폴리곤 구멍): https://navermaps.github.io/maps.js.ncp/docs/tutorial-4-Shape.html
- 네이버 Maps GL: https://navermaps.github.io/maps.js.ncp/docs/tutorial-1-GL.html
- 카카오 쿼터: https://developers.kakao.com/docs/latest/ko/getting-started/quota
- 카카오맵 신규 API 공지: https://devtalk.kakao.com/t/api-4/150764
- 공동주택 기본정보: https://www.data.go.kr/data/15058453/openapi.do
- 건축HUB 건축물대장: https://www.data.go.kr/en/data/15134735/openapi.do
- 매매 실거래 API 정리: https://wikidocs.net/342597
- 전월세 실거래: https://www.data.go.kr/data/15126474/openapi.do
- 정비사업 통합 데이터: https://www.data.go.kr/data/15160169/fileData.do
- 지오코더 API 메타(저장 금지): https://www.data.go.kr/dcat/metadata/15101106
- 행정경계: https://github.com/vuski/admdongkor
- SQL Server 2025 Express: https://www.bacloud.com/en/blog/234/sql-server-express-2025-free-version-new-features-for-developers.html
- DevExtreme Licensing: https://js.devexpress.com/DevExtreme/Guide/Common/Licensing

---

## 14. 개정 이력

| 일자 | 내용 |
|---|---|
| 2026-10-31 | 최초 작성 |
| 2026-11-01 | 개발 전 검토 반영: 실행 환경 실측 추가(§2.1.1), Node 24 LTS로 변경, SQLEXPRESS 고정 포트·전용 로그인·`useUTC:false`, DB DEV/PROD 분리 및 가계 연동 시노님(§4.4), `is_void` 제거 → `snapshot_void` INSERT 방식, carry_forward 값 구분·실효 관측일, 과거 일자 스냅샷의 실거래 기준일, 실거래 자연키·`dup_seq` upsert, 평형 매칭 오차, `region_code_map`, `listing` 스키마 선반영(A8), 서버 쿼터 가드(§5.2.1), 실거래 페이징, mapshaper·시 단위 경계 사전 생성, 클러스터링 보류, WinSW, LAN 노출 시 토큰 인증·업로드 제한, 백업 디스크 분리·서비스 계정 권한·보관 정리 예외, P0에 환경 준비·API 신청 추가, MVP=P0~P2, U12 해결 및 U14~U17 추가 |
| 2026-11-01 | 구현 중 확정: 1433 포트는 이미 127.0.0.1/::1 고정 리슨(변경 불필요), 로그인 명명 `aptlog_{env}_{app,mig}`(가계 시스템 규칙), `commute`도 append-only, `field_def.confirm_on_carry` 추가, 수동 단지 등록 API(§5.4 9번) 선구현, `/api/compare`·`/api/backup/status`·`/api/media` 구현, A2 가중치(`setting weight.*`) 구현. 진행 현황은 docs/PROGRESS.md |
| 2026-11-01 | 사용자 결정 반영: DB DEV/PROD 분리 확정, 복사값은 복사하되 호가·등급은 저장 전 확인 확정, **A8 매물 단위 스키마 선반영 취소**(평형 단위 호가만, 도입 시 마이그레이션 방법 §10 A8에 기록), **백업은 당분간 같은 디스크 별도 폴더**(경고 표시, 추후 이전) |
