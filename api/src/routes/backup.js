// 마지막 백업 결과 (scripts/backup.ps1 이 BACKUP_ROOT\logs\last_backup.json 에 기록)
import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function backupRouter({ config }) {
  const r = Router();
  r.get('/status', async (_req, res) => {
    try {
      const raw = await readFile(path.join(config.backupRoot, 'logs', 'last_backup.json'), 'utf8');
      res.json({ found: true, ...JSON.parse(raw.replace(/^﻿/, '')) });
    } catch {
      res.json({ found: false });
    }
  });
  return r;
}
