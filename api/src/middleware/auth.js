// HOST가 127.0.0.1이 아닐 때만 활성화되는 Bearer 토큰 인증
import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../util/errors.js';

export function requireToken(token) {
  const expected = Buffer.from(token);
  return (req, _res, next) => {
    const m = /^Bearer (.+)$/.exec(req.get('authorization') ?? '');
    const given = Buffer.from(m ? m[1] : '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return next(new AppError('UNAUTHORIZED', '인증이 필요합니다', 401));
    }
    next();
  };
}
