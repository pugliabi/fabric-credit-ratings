import { BAND_META, BAND_ORDER, GRADES, bandOf, gradeIndex, spokenGrade } from '../domain/grades';
import type { Grade, PublicRatingPoint } from '../domain/types';
import { formatMonth, formatMonthYear, parseDate } from '../lib/format';
import styles from './HistorySparkline.module.css';

const WIDTH = 360;
const HEIGHT = 150;
const PAD = { top: 10, right: 14, bottom: 24, left: 42 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;
const WINDOW_MONTHS = 12;
const MIN_SPAN = 6;
const MIN_LABEL_GAP = 11;

/** Zoom the y-axis to the notches this item has actually used, with a little headroom. */
function gradeWindow(history: PublicRatingPoint[]): { lo: number; hi: number } {
  const indexes = history.map((p) => gradeIndex(p.grade));
  let lo = Math.min(...indexes) - 2;
  let hi = Math.max(...indexes) + 2;
  while (hi - lo + 1 < MIN_SPAN) {
    lo -= 1;
    hi += 1;
  }
  const shift = Math.max(0, -lo) - Math.max(0, hi - (GRADES.length - 1));
  return { lo: Math.max(0, lo + shift), hi: Math.min(GRADES.length - 1, hi + shift) };
}

interface HistorySparklineProps {
  history: PublicRatingPoint[];
  asOf: string;
}

export function HistorySparkline({ history, asOf }: HistorySparklineProps) {
  const end = parseDate(asOf);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (WINDOW_MONTHS - 1), 1));
  const span = end.getTime() - start.getTime();
  const xFor = (date: Date) =>
    PAD.left + Math.min(1, Math.max(0, (date.getTime() - start.getTime()) / span)) * PLOT_W;

  const { lo, hi } = gradeWindow(history);
  const slotH = PLOT_H / (hi - lo + 1);
  const visible = GRADES.slice(lo, hi + 1);
  const yFor = (grade: Grade) => PAD.top + (gradeIndex(grade) - lo + 0.5) * slotH;

  const points = history.map((p) => ({ ...p, x: xFor(parseDate(p.date)), y: yFor(p.grade) }));
  const path = points
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `H ${p.x} V ${p.y}`))
    .concat(`H ${PAD.left + PLOT_W}`)
    .join(' ');

  const used = new Set(history.map((p) => p.grade));
  const axisGrades: Grade[] = [];
  const candidates = [...used].sort((a, b) => gradeIndex(a) - gradeIndex(b)).concat(visible.at(0) ?? [], visible.at(-1) ?? []);
  for (const g of candidates) {
    if (axisGrades.every((other) => Math.abs(yFor(other) - yFor(g)) >= MIN_LABEL_GAP)) axisGrades.push(g);
  }

  const months = Array.from({ length: WINDOW_MONTHS }, (_, i) => {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    return { date, x: xFor(date) };
  });

  const description = history.map((p) => `${spokenGrade(p.grade)} in ${formatMonthYear(p.date)}`).join(', ');

  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Rating history: ${description}`}
    >
      {BAND_ORDER.map((band) => {
        const inBand = visible.filter((g) => bandOf(g) === band);
        const first = inBand[0];
        if (!first) return null;
        return (
          <rect
            key={band}
            x={PAD.left}
            y={PAD.top + (gradeIndex(first) - lo) * slotH}
            width={PLOT_W}
            height={inBand.length * slotH}
            fill={BAND_META[band].background}
          />
        );
      })}

      {axisGrades.map((g) => (
        <text
          key={g}
          className={styles.axisLabel}
          data-used={used.has(g)}
          x={PAD.left - 6}
          y={yFor(g)}
          textAnchor="end"
          dominantBaseline="middle"
        >
          {g}
        </text>
      ))}

      {months.map(({ date, x }, i) => (
        <g key={date.toISOString()}>
          <line className={styles.gridLine} x1={x} x2={x} y1={PAD.top} y2={PAD.top + PLOT_H} />
          {i % 2 === 0 && (
            <text className={styles.axisLabel} x={x} y={HEIGHT - 8} textAnchor="start">
              {formatMonth(date)}
            </text>
          )}
        </g>
      ))}

      <path className={styles.line} d={path} />

      {points.map((p, i) => (
        <circle
          key={p.date}
          cx={p.x}
          cy={p.y}
          r={i === points.length - 1 ? 5 : 3.5}
          className={styles.dot}
          fill={BAND_META[bandOf(p.grade)].color}
        >
          <title>{`${formatMonthYear(p.date)}: ${p.grade}`}</title>
        </circle>
      ))}
    </svg>
  );
}
