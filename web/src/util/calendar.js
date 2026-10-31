// 월 달력 칸 계산 (월요일 시작, 6주 고정)
const pad = (n) => String(n).padStart(2, '0');
export const ymdOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** @returns {{ from:string, to:string, weeks: Array<Array<{date:string, day:number, inMonth:boolean}>> }} */
export function monthGrid(year, month /* 1~12 */) {
  const first = new Date(year, month - 1, 1);
  const offset = (first.getDay() + 6) % 7; // 월=0
  const start = new Date(year, month - 1, 1 - offset);
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i);
      row.push({ date: ymdOf(d), day: d.getDate(), inMonth: d.getMonth() === month - 1 });
    }
    weeks.push(row);
  }
  return { from: weeks[0][0].date, to: weeks[5][6].date, weeks };
}
