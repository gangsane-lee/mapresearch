// .env → 검증된 설정 객체. 잘못된 값이면 기동 거부.
import { z } from 'zod';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

const schema = z
  .object({
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(5180),
    API_TOKEN: z.string().optional(),
    DB_SERVER: z.string().min(1),
    DB_PORT: z.coerce.number().int().default(1433),
    DB_NAME: z.enum(['RealtyLog_DEV', 'RealtyLog_PROD', 'RealtyLog_TEST']),
    DB_USER: z.string().min(1),
    DB_PASSWORD: z.string().min(1),
    MEDIA_ROOT: z.string().min(1),
    BACKUP_ROOT: z.string().min(1),
    DATA_GO_KR_KEY: z.string().optional(),
    NCP_KEY_ID: z.string().optional(),
    NCP_CLIENT_SECRET: z.string().optional(),
    KAKAO_REST_KEY: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (!LOOPBACK.has(v.HOST) && (!v.API_TOKEN || v.API_TOKEN.length < 24)) {
      ctx.addIssue({
        code: 'custom',
        path: ['API_TOKEN'],
        message: 'HOST가 127.0.0.1이 아니면 24자 이상의 API_TOKEN이 필요합니다',
      });
    }
  });

export function loadConfig(env = process.env) {
  // 빈 문자열은 미설정으로 취급 (.env.example 의 "KEY=" 줄)
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const r = schema.safeParse(cleaned);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`설정 오류 (.env):\n${lines.join('\n')}`);
  }
  const c = r.data;
  return {
    host: c.HOST,
    port: c.PORT,
    apiToken: LOOPBACK.has(c.HOST) ? null : c.API_TOKEN,
    db: { server: c.DB_SERVER, port: c.DB_PORT, database: c.DB_NAME, user: c.DB_USER, password: c.DB_PASSWORD },
    mediaRoot: c.MEDIA_ROOT,
    backupRoot: c.BACKUP_ROOT,
    keys: {
      dataGoKr: c.DATA_GO_KR_KEY ?? null,
      ncpKeyId: c.NCP_KEY_ID ?? null,
      ncpClientSecret: c.NCP_CLIENT_SECRET ?? null,
      kakaoRest: c.KAKAO_REST_KEY ?? null,
    },
  };
}
