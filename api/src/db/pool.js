import sql from 'mssql';

export { sql };

export async function createPool(db) {
  return new sql.ConnectionPool({
    server: db.server,
    port: db.port,
    database: db.database,
    user: db.user,
    password: db.password,
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    options: {
      encrypt: true,
      trustServerCertificate: true, // 로컬 자체서명 인증서
      useUTC: false, // 모든 일시는 KST 로컬 (계획서 §2.1.1)
    },
  }).connect();
}
