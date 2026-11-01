# AptLog

아파트 갈아타기를 위한 임장·시세 기록 시스템입니다. 관심 단지를 지도에 등록하고, 방문할 때마다 호가·등급·메모를 **스냅샷**으로 남겨 시간에 따른 변화를 비교합니다. 실거래(국토부)와 단지 식별정보(한국부동산원)는 공공 데이터로 채웁니다.

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
git clone https://github.com/gangsane-lee/aptlog.git
cd aptlog
npm install
```

`npm install` 이 `sharp`(이미지 처리)의 Apple Silicon용 바이너리를 자동으로 받습니다.

### 3. 데이터 폴더 만들기

사진과 백업을 둘 폴더입니다. 외장 디스크가 생기면 나중에 `.env` 의 경로만 바꾸면 됩니다.

```bash
mkdir -p ~/AptLogData/media ~/AptLogBackup/{db,media,logs}
```

### 4. `.env` 작성

```bash
cp .env.example .env
open -e .env
```

텍스트 편집기에서 아래 값을 채우고 저장합니다. `<사용자>`는 `whoami` 로 나오는 맥 계정 이름입니다.

| 키 | 값 |
|---|---|
| `DB_NAME` | `RealtyLog_PROD` (실사용) 또는 `RealtyLog_DEV` (연습) |
| `DB_USER` / `MIGRATE_USER` | PROD면 `aptlog_prod_app` / `aptlog_prod_mig`, DEV면 `aptlog_dev_app` / `aptlog_dev_mig` |
| `DB_PASSWORD` / `MIGRATE_PASSWORD` | 새로 정하는 비밀번호. 12자 이상, `'` `"` `$` 사용 불가 |
| `MSSQL_SA_PASSWORD` | SQL Server 관리자(sa) 비밀번호. 8자 이상 + 대문자·소문자·숫자·특수문자 중 3종 (`$` 제외 권장) |
| `MEDIA_ROOT` | `/Users/<사용자>/AptLogData/media` |
| `BACKUP_ROOT` | `/Users/<사용자>/AptLogBackup` |
| `BACKUP_SQL_DIR` | `/var/opt/mssql/backup` (그대로) |
| `DATA_GO_KR_KEY` | 공공데이터포털 인증키 (실거래 동기화) |
| `NCP_KEY_ID` / `NCP_CLIENT_SECRET` | 네이버 클라우드 Maps Application 키 (지도·우클릭 주소) |

`.env` 는 비밀값이 들어 있어 Git에 올라가지 않습니다(`.gitignore`). 다른 곳에 복사하지 마세요.

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
npm run db:setup     # RealtyLog_{DEV|PROD} DB + aptlog_*_app / aptlog_*_mig 로그인 (재실행해도 안전)
npm run migrate      # 테이블·뷰·권한 + 기본 데이터(seed: 항목 정의·기준점·시군구 경계)
npm run migrate:status
```

`migrate:status` 에서 모든 파일이 `적용` 이면 됩니다. 행정경계(`web/public/geo`)와 시군구 seed는 저장소에 들어 있어 따로 빌드할 필요가 없습니다.

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
```

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
- 코드를 업데이트한 뒤에는 `npm install && npm run migrate && npm run build` 후 `launchctl kickstart -k gui/$(id -u)/com.aptlog.api` 로 서버를 다시 시작합니다.
- 맥이 **잠자기** 중이면 깨어난 뒤 실행되지만, **전원이 꺼져** 있던 동안의 일정은 건너뜁니다. 시스템 설정 › 에너지 에서 "디스플레이가 꺼져 있을 때 자동으로 잠자기 방지"를 켜 두면 안정적입니다.

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

1. **윈도우**에서 백업: `powershell -ExecutionPolicy Bypass -File scripts\backup.ps1` → `C:\AptLogBackup\db\RealtyLog_PROD_yyyyMMdd.bak`
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

4. 로그인 만들기 + 끊긴 사용자 다시 연결 (서버가 바뀌면 로그인 ID가 달라져 연결이 끊깁니다):

   ```bash
   npm run db:setup
   sqlcmd -S 127.0.0.1 -U sa -P "$MSSQL_SA_PASSWORD" -C -d RealtyLog_PROD -Q "
   ALTER USER [aptlog_prod_app] WITH LOGIN = [aptlog_prod_app];
   ALTER USER [aptlog_prod_mig] WITH LOGIN = [aptlog_prod_mig];"
   npm run migrate
   ```

5. 7단계(단지 식별정보)는 이미 DB에 들어 있으므로 건너뛰고 8단계부터 진행합니다.

---

## 개발

```bash
npm run dev:api      # API (파일 바뀌면 자동 재시작, 127.0.0.1:5180)
npm run dev:web      # 화면 개발 서버 (Vite, /api 는 5180 으로 프록시)
npm test             # 단위 테스트 (db·geo·scripts·api: node:test / web: vitest)
```

**실DB 통합 테스트**는 전용 DB `RealtyLog_TEST` 에서만 돕니다. 테스트가 `벽산 시험 1101-153012` 같은 이름의 단지를 매번 만들기 때문에 실사용 DB와 분리합니다.

```bash
cp .env .env.test    # 열어서 DB_NAME=RealtyLog_TEST, DB_USER=aptlog_test_app, MIGRATE_USER=aptlog_test_mig 로 바꾸고 비밀번호 지정
node scripts/setup-db.js --env-file .env.test
npm run test:db
```

### 자주 쓰는 명령

| 명령 | 내용 |
|---|---|
| `npm run migrate` / `migrate:status` | 마이그레이션 적용 / 현황 |
| `npm run db:setup` | DB·로그인 생성 (재실행 안전) |
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

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| `docker compose up` 후 컨테이너가 바로 꺼짐 | Docker Desktop 의 Rosetta 옵션, 메모리 4GB, `MSSQL_SA_PASSWORD` 복잡도. `docker compose logs mssql` |
| `Login failed for user 'aptlog_…'` | `.env` 비밀번호가 `db:setup` 때와 같은지. 윈도우 DB를 복원했다면 "기존 윈도우 PC 데이터 옮기기" 4번 |
| `호환성 수준 170` 관련 오류 | SQL Server 2025 이미지인지 (`docker-compose.yml` 의 `2025-latest`) |
| 지도가 회색/인증 오류 | 네이버 콘솔 Web 서비스 URL, `NCP_KEY_ID`. 브라우저 주소가 `127.0.0.1:5180` 인지 |
| `/geo/index.json 를 불러올 수 없습니다` | `web/public/geo` 가 있는지, `npm run build` 를 다시 했는지 |
| 포트 5180 사용 중 | `lsof -i :5180` 으로 이미 떠 있는 서버(launchd 포함) 확인 |
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
