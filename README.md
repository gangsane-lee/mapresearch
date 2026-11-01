# AptLog (맵리서치)

아파트 갈아타기를 위한 임장·시세 기록 시스템입니다. 관심 단지를 지도에 등록하고, 방문할 때마다 호가·등급·메모를 **스냅샷**으로 남겨 시간에 따른 변화를 비교합니다. 실거래(국토부)와 단지 식별정보(한국부동산원)는 공공 데이터로 채웁니다.

**주요 기능**

- 지도: 구/시 검색(전국)·경계 강조, 단지 명패 마커, 왼쪽 "내 단지" 목록(검색·정렬·업데이트 필요 표시), 지도 유형·지적편집도·교통 레이어
- 등록: 지도 우클릭 → 그 위치의 단지 후보(네이버 역지오코딩 + 단지 식별정보) → 단지 추가, Ctrl+드래그 영역 비교
- 스냅샷: 호가·교통·환경·학군·결론 기록(가격 먼저, 항목별 비고), 직전 값 복사, 수정은 정정본으로(이력 보존), 저장 이력·시점별 보고서
- 교통: 기준점(현재 집·직장·주요 역)까지 대중교통 시간 자동 계산(카카오), 직선거리
- 시세: 실거래 매매·전월세 자동 수집(행정구역 개편 코드 대응), 호가 괴리율·가격 알림, 평형 면적을 실거래 면적에 맞추기
- 판단: ★ 관심·진행 상태, 비교표·가중 점수, **매수 검토**(예산 대비 취득세·중개보수 포함 총 필요 자금), 임장 보고서 인쇄/PDF

- 기준 문서: [APTLOG_DEV_PLAN.md](APTLOG_DEV_PLAN.md) (요구사항·스키마·API·단계)
- 작업 규칙: [CLAUDE.md](CLAUDE.md) · 진행 현황: [docs/PROGRESS.md](docs/PROGRESS.md)
- 화면은 **데스크톱 전용**입니다 (최소 폭 1024px).

| 구분 | 사용 기술 |
|---|---|
| 화면 | Vue 3.5, Vite 8, Pinia 4, vue-router 5, ECharts 6, 네이버 지도 JS API v3 |
| 서버 | Node.js 24 LTS, Express 5, mssql 12, zod 4, sharp |
| DB | SQL Server 2025 Express (맥: Docker 컨테이너) |

```
api/        Express API (src/routes, src/services, src/external = 외부 API 호출)
web/        Vue 화면 (npm run build → web/dist, API 서버가 함께 서빙)
db/         migrations(NNN_*.sql, 수정 금지·추가만), seed, setup(DB·로그인 생성 SQL)
geo/        행정경계 GeoJSON 빌드 (결과물은 web/public/geo, db/seed/040_region.sql 에 이미 포함)
scripts/    적재·동기화·백업 (Node, OS 무관) / mac/ (launchd) / *.ps1 (윈도우 전용)
shared/     api·scripts 공용 파서
docs/       진행 현황, 실제 API 응답 샘플
```

---

## 맥미니 설치 (macOS, Apple Silicon)

처음 한 번만 하는 작업입니다. 위에서부터 순서대로 진행하세요. 명령은 모두 **터미널**(응용 프로그램 › 유틸리티 › 터미널)에서 실행합니다.

### 1. 기본 도구 설치

1. **Homebrew** (맥 패키지 관리자) — 이미 있으면 건너뜁니다.

   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

   설치가 끝나면 화면 마지막에 나오는 `echo ... >> ~/.zprofile` 두 줄을 그대로 실행해 `brew` 경로를 등록합니다.

2. **Git, Node.js 24, SQL 명령줄 도구**

   ```bash
   brew install git node@24 sqlcmd
   brew link --overwrite node@24
   node -v      # v24.x 확인
   ```

   `sqlcmd`는 백업 복원·점검 때만 씁니다(설치·실행은 Node 스크립트로 됩니다).

3. **Docker Desktop** — <https://www.docker.com/products/docker-desktop/> 에서 *Apple Silicon* 용을 받아 설치하고 실행합니다.
   - Settings › General › **Use Rosetta for x86_64/amd64 emulation on Apple Silicon** 를 켭니다.
     SQL Server 리눅스 이미지는 amd64 전용이라 이 옵션이 있어야 실행됩니다.
   - Settings › Resources › Memory 를 **4GB 이상**으로 둡니다 (SQL Server 최소 2GB).
   - Settings › General › **Start Docker Desktop when you sign in** 를 켜 두면 재부팅 후에도 DB가 자동으로 올라옵니다.

### 2. 코드 받기

```bash
mkdir -p ~/code && cd ~/code
git clone https://github.com/gangsane-lee/mapresearch.git
cd mapresearch
npm install
```

`npm install` 이 `sharp`(이미지 처리)의 Apple Silicon용 바이너리를 자동으로 받습니다.

### 3. 데이터 폴더 만들기

사진과 백업을 둘 폴더입니다. 외장 디스크가 생기면 나중에 `.env` 의 경로만 바꾸면 됩니다.

```bash
mkdir -p ~/AptLogData/media ~/AptLogBackup/{db,media,logs}
```

### 4. `.env` 작성 — 운영(`.env`)과 개발(`.env.dev`) 두 개

맥미니 한 대에서 **운영**(매일 쓰는 실제 데이터, 자동 실행)과 **개발**(코드 수정·시험)을 함께 합니다. DB와 포트를 나눠 서로 영향이 없게 합니다.

| | 운영 `.env` | 개발 `.env.dev` |
|---|---|---|
| DB | `RealtyLog_PROD` (`aptlog_prod_app` / `aptlog_prod_mig`) | `RealtyLog_DEV` (`aptlog_dev_app` / `aptlog_dev_mig`) |
| 서버 | `PORT=5180` — launchd 가 상시 실행, 빌드된 화면 | `PORT=5181` — `npm run dev` 로 띄울 때만, 화면은 Vite `5173` |
| 주소 | <http://127.0.0.1:5180> | <http://localhost:5173> (저장하면 바로 반영) |

```bash
cp .env.example .env
open -e .env
```

텍스트 편집기에서 아래 값을 채우고 저장합니다. `<사용자>`는 `whoami` 로 나오는 맥 계정 이름입니다. 다 채운 뒤 개발용을 복사해 DB·포트·로그인만 바꿉니다:

```bash
cp .env .env.dev
open -e .env.dev
```

`.env.dev` 에서 바꿀 값: `PORT=5181`, `DB_NAME=RealtyLog_DEV`, `DB_USER=aptlog_dev_app`, `MIGRATE_USER=aptlog_dev_mig`, 두 비밀번호는 새로 정합니다.

| 키 | 값 |
|---|---|
| `PORT` | 운영 `5180` (개발용 `.env.dev` 는 `5181`) |
| `DB_NAME` | 운영 `RealtyLog_PROD` (개발용 `.env.dev` 는 `RealtyLog_DEV`) |
| `DB_USER` / `MIGRATE_USER` | 운영 `aptlog_prod_app` / `aptlog_prod_mig` (개발 `aptlog_dev_app` / `aptlog_dev_mig`) |
| `DB_PASSWORD` / `MIGRATE_PASSWORD` | 새로 정하는 비밀번호. 12자 이상, `'` `"` `$` 사용 불가 |
| `MSSQL_SA_PASSWORD` | SQL Server 관리자(sa) 비밀번호. 8자 이상 + 대문자·소문자·숫자·특수문자 중 3종 (`$` 제외 권장) |
| `MEDIA_ROOT` | `/Users/<사용자>/AptLogData/media` |
| `BACKUP_ROOT` | `/Users/<사용자>/AptLogBackup` |
| `BACKUP_SQL_DIR` | `/var/opt/mssql/backup` (그대로) |
| `DATA_GO_KR_KEY` | 공공데이터포털 인증키 (실거래 동기화) |
| `KAKAO_REST_KEY` | 카카오 개발자 REST API 키 (스냅샷의 기준 역 대중교통 시간 자동 계산). [카카오 개발자](https://developers.kakao.com) › 내 애플리케이션 › 앱 만들기 → 앱 키의 REST API 키, 제품 설정에서 **카카오맵 사용 설정**을 켭니다. 계정의 첫 번째 활성 앱이어야 무료 한도(일 1,000건)가 적용됩니다 |
| `NCP_KEY_ID` / `NCP_CLIENT_SECRET` | 네이버 클라우드 Maps Application 키 (지도·우클릭 주소) |

`.env`·`.env.dev`·`.env.test` 는 비밀값이 들어 있어 Git에 올라가지 않습니다(`.gitignore`). **저장소는 공개(public)**이므로 키·비밀번호를 코드나 문서에 절대 적지 마세요.

### 5. SQL Server 실행 (Docker)

```bash
docker compose up -d
docker compose logs -f mssql      # "SQL Server is now ready for client connections" 가 보이면 Ctrl+C
```

- 처음에는 이미지(약 1.5GB)를 받느라 몇 분 걸립니다.
- DB 파일은 Docker 볼륨 `aptlog-mssql-data` 에 저장되어 컨테이너를 지워도 남습니다.
- 백업 파일은 맥의 `~/AptLogBackup/db` 에 바로 생깁니다(컨테이너 안에서는 `/var/opt/mssql/backup`).
- 포트는 `127.0.0.1:1433` 에만 열려 같은 망의 다른 기기에서는 접속할 수 없습니다.

접속 확인:

```bash
source .env && sqlcmd -S 127.0.0.1 -U sa -P "$MSSQL_SA_PASSWORD" -C -Q "SELECT @@VERSION, SYSDATETIME()"
```

`SYSDATETIME()` 이 한국 시각이면 정상입니다(컨테이너 `TZ=Asia/Seoul`).

### 6. DB·로그인 만들기, 스키마 적용

```bash
npm run db:setup         # 운영: RealtyLog_PROD + aptlog_prod_* 로그인 (재실행해도 안전)
npm run migrate          # 운영: 테이블·뷰·권한 + 기본 데이터(seed: 항목 정의·기준점·시군구 경계·행정구역 코드 대응)
npm run db:setup:dev     # 개발: RealtyLog_DEV + aptlog_dev_*
npm run migrate:dev      # 개발
npm run migrate:status
```

`db:setup` 은 다른 PC 백업을 복원한 DB의 끊긴 로그인 연결과 앱 권한(role)도 함께 바로잡습니다.

`migrate:status` 에서 모든 파일이 `적용` 이면 됩니다. 행정경계(`web/public/geo`)와 시군구 seed는 저장소에 들어 있어 따로 빌드할 필요가 없습니다.

여기까지 왔으면 한 번 점검합니다 (아래 [설치 점검](#설치-점검-npm-run-check) 참고).

```bash
npm run check
```

### 7. 단지 식별정보 적재 (단지 검색에 필요)

[공공데이터포털](https://www.data.go.kr)에서 **"한국부동산원_공동주택 단지 식별정보_기본정보"** CSV를 내려받아 프로젝트 폴더에 둡니다(재배포 금지라 저장소에는 없습니다).

```bash
npm run kapt:import -- --file "한국부동산원_공동주택 단지 식별정보_기본정보_20260831.csv"           # 미리보기
npm run kapt:import -- --file "한국부동산원_공동주택 단지 식별정보_기본정보_20260831.csv" --apply   # 적재
```

분기마다 새 파일이 나오면 같은 방법으로 다시 적재합니다(같은 단지는 갱신).

### 8. 빌드·실행

```bash
npm run build        # 화면(web/dist) 빌드
npm start            # API + 화면 서버
```

브라우저에서 <http://127.0.0.1:5180> 을 엽니다. <http://127.0.0.1:5180/api/health> 가 `{"ok":true,...}` 이면 서버 정상입니다.

### 9. 네이버 지도 서비스 URL 확인

[네이버 클라우드 콘솔](https://console.ncloud.com) › AI·Application Service › Maps › Application › 수정 › **Web 서비스 URL** 에 아래 두 개가 있어야 지도가 뜹니다(윈도우에서 쓰던 것과 같음).

```
http://127.0.0.1:5180
http://localhost:5180
http://127.0.0.1:5173
http://localhost:5173
```

5173 은 개발 화면입니다. 지도 인증은 화면 주소 기준이라 개발 API 포트 5181 은 등록하지 않아도 됩니다.

일·월 이용 한도(쿼터)는 콘솔과 앱 설정 화면 양쪽에서 무료 한도보다 낮게 유지합니다.

### 10. 자동 실행 등록 (launchd)

맥을 켜고 로그인하면 서버가 자동으로 뜨고, 백업과 실거래 동기화가 정해진 시각에 돌게 합니다.

```bash
bash scripts/mac/install-launchd.sh
```

| 작업 | 일정 | 내용 |
|---|---|---|
| `com.aptlog.api` | 로그인 시, 죽으면 재시작 | API + 화면 서버 (8번의 `npm start` 대신) |
| `com.aptlog.backup` | 매일 21:00 | DB 백업(`.bak`, 14일 보관) + 사진 증분 복사 |
| `com.aptlog.trades` | 매주 월 07:30 | 등록 단지 시군구의 최근 3개월 실거래 |

- 등록 전에 8번에서 띄운 서버는 Ctrl+C 로 끕니다(포트 충돌).
- 로그: `~/Library/Logs/AptLog/`
- 지금 바로 한 번 실행: `launchctl kickstart gui/$(id -u)/com.aptlog.backup`
- 해제: `bash scripts/mac/install-launchd.sh --uninstall`
- 코드를 업데이트한 뒤에는 `npm install && npm run backup && npm run migrate && npm run build` 후 `launchctl kickstart -k gui/$(id -u)/com.aptlog.api` 로 서버를 다시 시작합니다 (자세한 순서는 "개발과 운영").
- 맥이 **잠자기** 중이면 깨어난 뒤 실행되지만, **전원이 꺼져** 있던 동안의 일정은 건너뜁니다. 시스템 설정 › 에너지 에서 "디스플레이가 꺼져 있을 때 자동으로 잠자기 방지"를 켜 두면 안정적입니다.

### 설치 점검 (`npm run check`)

설치가 제대로 됐는지 한 번에 확인하는 명령입니다. 아무것도 바꾸지 않고 읽기만 하며, 비밀번호·키 값은 출력하지 않습니다(설정 여부만). 각 단계 뒤에 언제든 실행해도 됩니다.

```bash
npm run check
```

```
[3. SQL Server]
✓ 컨테이너 aptlog-mssql — running
✓ 앱 로그인 aptlog_prod_app → RealtyLog_PROD
✓ SQL Server 버전 17 (Express Edition (64-bit)) — 2025
✓ DB 시각이 이 PC 시각(KST)과 같음 — 0분 차이
[4. 스키마·기본 데이터]
✗ 마이그레이션 0/5 적용
    → npm run migrate
...
결과: 통과 21 · 경고 2 · 실패 1
```

`✗` 줄 아래 `→` 안내대로 고친 뒤 다시 실행해 실패가 0이 되면 설치가 끝난 것입니다. `!` 경고는 동작은 하지만 확인이 필요한 항목입니다(예: 단지 식별정보 미적재, 서버 미기동, 백업이 같은 디스크).

| 구역 | 확인하는 것 |
|---|---|
| 1. 도구 | Node 24·arm64, `npm install` 여부 |
| 2. .env | 필수 값, 키 설정 여부, 사진·백업 폴더 쓰기 권한 |
| 3. SQL Server | Docker 컨테이너 실행, 앱 로그인, 2025 버전, 호환성 170, 한글 정렬, 한국 시각 |
| 4. 스키마·기본 데이터 | 마이그레이션 적용 수, 시군구·항목 정의·쿼터 seed, 단지 식별정보 건수, 스냅샷 수정·삭제 차단 권한 |
| 5. 화면·서버 | 행정경계 파일, 화면 빌드가 최신인지, 서버 응답 |
| 6. 자동 실행·백업 | launchd 3개 등록, 마지막 백업 성공·경과 시간 |

### 11. 백업 확인과 복원 연습

```bash
npm run backup                 # 수동 백업 1회
ls -lh ~/AptLogBackup/db       # RealtyLog_PROD_yyyyMMdd.bak 확인
```

앱 › 설정 › 백업 에 마지막 백업 결과가 표시됩니다. 백업이 원본과 같은 디스크에 있으면 경고가 함께 뜹니다.

**복원 연습** (원본은 건드리지 않고 별도 DB `RealtyLog_RestoreTest` 로 복원):

```bash
source .env
F=RealtyLog_PROD_20261101.bak          # 복원할 파일 이름
sqlcmd -S 127.0.0.1 -U sa -P "$MSSQL_SA_PASSWORD" -C -Q "
RESTORE DATABASE [RealtyLog_RestoreTest] FROM DISK = N'/var/opt/mssql/backup/$F'
WITH CHECKSUM,
  MOVE N'RealtyLog_PROD'     TO N'/var/opt/mssql/data/RealtyLog_RestoreTest.mdf',
  MOVE N'RealtyLog_PROD_log' TO N'/var/opt/mssql/data/RealtyLog_RestoreTest_log.ldf';
SELECT COUNT(*) AS complexes FROM RealtyLog_RestoreTest.dbo.complex;"
```

논리 파일 이름이 다르다는 오류가 나면 `RESTORE FILELISTONLY FROM DISK = N'/var/opt/mssql/backup/$F'` 로 이름을 확인해 `MOVE` 에 넣습니다. 확인 후 연습용 DB는 직접 판단해 지웁니다.

**실제 복원** (장애 시):

1. 서버 중지: `launchctl bootout gui/$(id -u)/com.aptlog.api`
2. 복원:

   ```bash
   sqlcmd -S 127.0.0.1 -U sa -P "$MSSQL_SA_PASSWORD" -C -Q "
   ALTER DATABASE [RealtyLog_PROD] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
   RESTORE DATABASE [RealtyLog_PROD] FROM DISK = N'/var/opt/mssql/backup/$F' WITH REPLACE, CHECKSUM;
   ALTER DATABASE [RealtyLog_PROD] SET MULTI_USER;"
   ```

3. 사진: `rsync -a --ignore-existing ~/AptLogBackup/media/ ~/AptLogData/media/` (원본에 없는 파일만 되돌림, `--delete` 금지)
4. `npm run migrate:status` 로 스키마 확인 → `bash scripts/mac/install-launchd.sh` 로 서버 재등록

---

## 기존 윈도우 PC 데이터 옮기기

윈도우에서 이미 기록한 데이터가 있을 때만 합니다. 새로 시작하면 건너뜁니다.

> **2026-11 현재 실데이터는 윈도우 PC의 `RealtyLog_DEV`** 에 있습니다(등록 단지·스냅샷·실거래·단지 식별정보 46,385개). 그래서 받는 파일은 `RealtyLog_DEV_yyyyMMdd.bak` 입니다. 맥에서는 이 파일 하나를 **운영 DB(`RealtyLog_PROD`)로 복원**하고, 같은 파일을 **개발 DB(`RealtyLog_DEV`)로도 한 번 더 복원**합니다. 아래 예시의 파일명·`MOVE` 의 논리 이름은 `RESTORE FILELISTONLY` 결과대로 바꿉니다(이 경우 `RealtyLog_DEV` / `RealtyLog_DEV_log`).

1. **윈도우**에서 백업: 프로젝트 폴더에서 `npm run backup` (또는 `scripts\backup.ps1`) → `C:\AptLogBackup\db\RealtyLog_DEV_yyyyMMdd.bak`
2. 그 `.bak` 파일과 `C:\AptLogData\media` 폴더를 USB 등으로 맥에 복사:
   - `.bak` → `~/AptLogBackup/db/`
   - `media` 안의 내용 → `~/AptLogData/media/`
3. **맥**에서 위 1~5단계까지 진행한 뒤(6단계 전), 윈도우 백업으로 DB를 만듭니다. 윈도우 DB의 파일 이름은 `RESTORE FILELISTONLY` 로 확인합니다.

   ```bash
   source .env
   F=RealtyLog_PROD_20261101.bak
   sqlcmd -S 127.0.0.1 -U sa -P "$MSSQL_SA_PASSWORD" -C -Q "RESTORE FILELISTONLY FROM DISK = N'/var/opt/mssql/backup/$F'"
   sqlcmd -S 127.0.0.1 -U sa -P "$MSSQL_SA_PASSWORD" -C -Q "
   RESTORE DATABASE [RealtyLog_PROD] FROM DISK = N'/var/opt/mssql/backup/$F'
   WITH CHECKSUM,
     MOVE N'RealtyLog_PROD'     TO N'/var/opt/mssql/data/RealtyLog_PROD.mdf',
     MOVE N'RealtyLog_PROD_log' TO N'/var/opt/mssql/data/RealtyLog_PROD_log.ldf';"
   ```

   개발 DB도 같은 파일로: 위 명령의 `[RealtyLog_PROD]` 와 `.mdf`/`.ldf` 이름을 `RealtyLog_DEV` 로 바꿔 한 번 더 실행합니다.

4. 로그인 만들기 + 끊긴 사용자 다시 연결 + 앱 권한 — `db:setup` 이 한 번에 처리합니다:

   ```bash
   npm run db:setup && npm run migrate              # 운영 DB
   npm run db:setup:dev && npm run migrate:dev      # 개발 DB
   npm run check
   ```

5. 7단계(단지 식별정보)는 이미 DB에 들어 있으므로 건너뛰고 8단계부터 진행합니다.

---

## 개발과 운영 (한 맥미니에서)

평소에는 운영 서버(launchd, 5180)가 늘 떠 있고, 고칠 때만 개발 서버를 따로 띄웁니다.

```bash
npm run dev          # 개발: API(.env.dev, 5181, 저장 시 재시작) + 화면(Vite 5173, 저장 즉시 반영) 한 번에. 끌 때 Ctrl+C
npm test             # 단위 테스트 (db·geo·scripts·api: node:test / web: vitest)
```

**고친 코드를 운영에 반영하는 순서**

1. 개발 DB에 먼저: `npm run migrate:dev` (새 마이그레이션이 있을 때) → <http://localhost:5173> 에서 확인 → `npm test`
2. 운영 반영 — **운영 DB 마이그레이션 전에는 반드시 백업**:

   ```bash
   npm run backup && npm run migrate && npm run build
   launchctl kickstart -k gui/$(id -u)/com.aptlog.api
   npm run check
   ```

3. Git에 올리기: `git add -A && git commit -m "변경 내용" && git push`

개발 DB를 운영 데이터로 다시 맞추고 싶으면 운영 백업 파일을 `RealtyLog_DEV` 로 복원한 뒤 `npm run db:setup:dev` 를 실행합니다.

**실DB 통합 테스트**는 전용 DB `RealtyLog_TEST` 에서만 돕니다. 테스트가 `벽산 시험 1101-153012` 같은 이름의 단지를 매번 만들기 때문에 실사용 DB와 분리합니다.

```bash
cp .env .env.test    # 열어서 DB_NAME=RealtyLog_TEST, DB_USER=aptlog_test_app, MIGRATE_USER=aptlog_test_mig 로 바꾸고 비밀번호 지정
node scripts/setup-db.js --env-file .env.test
npm run test:db
```

### 자주 쓰는 명령

| 명령 | 내용 |
|---|---|
| `npm run dev` | 개발 서버 (API 5181 + 화면 5173, 실시간 반영) |
| `npm run migrate` / `migrate:dev` / `migrate:status` | 마이그레이션 적용 (운영 / 개발) / 현황 |
| `npm run check` / `check:dev` | 설치 점검 (읽기 전용) |
| `npm run db:setup` / `db:setup:dev` | DB·로그인 생성, 복원 후 로그인·권한 정리 (재실행 안전) |
| `npm run backup` | 백업 1회 |
| `npm run trades:sync` | 실거래 동기화 (등록 단지 시군구 × 최근 3개월). `-- --sgg 11620 --months 12` 로 지정 |
| `npm run kapt:import -- --file <CSV> [--apply]` | 단지 식별정보 적재 (아파트만, `--kinds 1,2,3` 으로 연립·다세대 포함) |
| `node scripts/import-redev.js --file <CSV> --year 2026 [--apply]` | 정비사업 CSV 적재 (연 1회) |
| `node scripts/probe-api.js --lawd 11620 --ym 202608` | 공공 API 응답 확인 |
| `npm run geo:build` | 행정경계 다시 빌드 (경계 데이터가 바뀔 때만, `geo/raw/` 에 원본 필요) |

### 규칙 요약 (자세한 내용은 CLAUDE.md)

- 금액은 DB·API 모두 **만원 정수**, 억 변환은 화면에서만. 일시는 KST.
- 스냅샷(`snapshot*`)은 INSERT만 — 수정은 정정본, 삭제는 무효 처리.
- DB 변경은 `db/migrations/NNN_*.sql` **새 파일**로만. 이미 적용된 파일을 고치면 migrate가 멈춥니다.
- 모든 외부 API 호출은 쿼터 가드를 거치고, 화면 로딩 중에는 외부 API를 부르지 않습니다.
- 비밀값은 `.env` 에만. 프론트로 내보내는 키는 `NCP_KEY_ID` 뿐입니다.

---

## Claude Code로 이어서 개발하기

이 저장소는 Claude Code가 바로 이해하도록 구성돼 있습니다.

1. 설치: `curl -fsSL https://claude.ai/install.sh | bash` (또는 Claude 데스크톱 앱의 Code 탭)
2. 프로젝트 폴더에서 `claude` 실행 (데스크톱 앱이면 이 폴더를 열기)
3. Claude Code가 자동으로 읽는 것
   - [CLAUDE.md](CLAUDE.md) — 작업 규칙(스냅샷은 INSERT만, 마이그레이션은 새 파일만, 외부 API 쿼터 가드, 비밀값은 `.env` 만 등)과 맥미니 개발·운영 방법
   - `.claude/launch.json` — 미리보기 서버 `aptlog-web-hmr`(화면 5173) + `aptlog-api-dev`(API 5181, `.env.dev`)
4. 처음 시킬 말 예시: "docs/PROGRESS.md 와 APTLOG_DEV_PLAN.md §14 를 읽고 현재 상태를 요약해줘"

`.env` 파일들은 저장소에 없으므로 새 PC에서는 이 README 4단계대로 직접 만듭니다.

---

## 문제 해결

먼저 `npm run check` 로 어느 단계가 빠졌는지 확인합니다.

| 증상 | 확인할 것 |
|---|---|
| `docker compose up` 후 컨테이너가 바로 꺼짐 | Docker Desktop 의 Rosetta 옵션, 메모리 4GB, `MSSQL_SA_PASSWORD` 복잡도. `docker compose logs mssql` |
| `Login failed for user 'aptlog_…'` | `.env` 비밀번호가 `db:setup` 때와 같은지. 윈도우 DB를 복원했다면 "기존 윈도우 PC 데이터 옮기기" 4번 |
| `호환성 수준 170` 관련 오류 | SQL Server 2025 이미지인지 (`docker-compose.yml` 의 `2025-latest`) |
| 지도가 회색/인증 오류 | 네이버 콘솔 Web 서비스 URL, `NCP_KEY_ID`. 브라우저 주소가 `127.0.0.1:5180` 인지 |
| `/geo/index.json 를 불러올 수 없습니다` | `web/public/geo` 가 있는지, `npm run build` 를 다시 했는지 |
| 포트 5180 사용 중 | `lsof -i :5180` 으로 이미 떠 있는 서버(launchd 포함) 확인. 개발은 `.env.dev` 의 `PORT=5181` 인지 |
| 단지에 실거래가 안 붙음 | 상세 › 개요 › 평형 표의 "실거래 면적" 에서 "맞추기" (등록 때 평→㎡ 추정값이 실제 면적과 다를 때) |
| 화성시 등 개편 지역 실거래 0건 | `npm run migrate` 로 seed `030_region_code_map.sql`(새 구 코드 대응)이 들어갔는지 |
| `sharp` 설치 오류 | `rm -rf node_modules && npm install` (Node 24 arm64 인지 `node -p process.arch`) |
| 백업 실패 `Operating system error 5` | `~/AptLogBackup/db` 폴더가 있는지, `docker compose up -d` 를 그 뒤에 다시 했는지 |

---

## 부록: 윈도우에서 실행

윈도우 PC에서는 SQL Server 2025 Express(`.\SQLEXPRESS`)를 직접 설치해 씁니다. 관리자 PowerShell에서:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-sqlserver.ps1 -Env PROD   # DB·로그인·폴더 (Windows 인증)
npm run migrate
npm run build
powershell -ExecutionPolicy Bypass -File scripts\register-backup-task.ps1        # 백업 매일 21:00
powershell -ExecutionPolicy Bypass -File scripts\register-trade-task.ps1         # 실거래 매주 월 07:30
powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1             # API 윈도우 서비스 (WinSW)
powershell -ExecutionPolicy Bypass -File scripts\restore-test.ps1 -Source PROD   # 복원 연습
```

`.env` 의 `BACKUP_SQL_DIR` 는 비워 두고, `MEDIA_ROOT=C:\AptLogData\media`, `BACKUP_ROOT=C:\AptLogBackup` 처럼 씁니다.
