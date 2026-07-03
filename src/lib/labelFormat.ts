// User-chosen label output format (paper size + labels per page), remembered in
// localStorage so each operator keeps their preference.

export type PaperKey = 'a4' | '4x6' | '4x4' | '4x3' | '3x3' | '3x2' | '2x2';

export interface LabelFormat {
  paper: PaperKey;
  perPage: number;
}

export const PAPER_OPTIONS: { key: PaperKey; label: string }[] = [
  { key: '4x6', label: '4 × 6 in (thermal)' },
  { key: '4x4', label: '4 × 4 in' },
  { key: '4x3', label: '4 × 3 in' },
  { key: '3x3', label: '3 × 3 in' },
  { key: '3x2', label: '3 × 2 in' },
  { key: '2x2', label: '2 × 2 in' },
  { key: 'a4', label: 'A4 sheet' },
];

// Page/label sizes in points (1in = 72pt).
export const PAPER_PT: Record<PaperKey, [number, number]> = {
  a4: [595.28, 841.89],
  '4x6': [288, 432], '4x4': [288, 288], '4x3': [288, 216],
  '3x3': [216, 216], '3x2': [216, 144], '2x2': [144, 144],
};
// Labels-per-page → grid [cols, rows].
export const GRID: Record<number, [number, number]> = { 1: [1, 1], 2: [1, 2], 4: [2, 2], 6: [2, 3], 8: [2, 4] };

// Which labels-per-page counts each paper allows. Only A4 sheets are multi-up
// (2/4/6/8); every dedicated label size is always one per page.
export const PER_PAGE_BY_PAPER: Record<PaperKey, number[]> = {
  a4: [2, 4, 6, 8],
  '4x6': [1], '4x4': [1], '4x3': [1], '3x3': [1], '3x2': [1], '2x2': [1],
};

export function perPageOptionsFor(paper: PaperKey): number[] {
  return PER_PAGE_BY_PAPER[paper] || [1];
}

// Sheet geometry for a format: the per-label cell size, plus the cutting gutter
// between labels and the outer page margin (A4 sheets get equal gaps so labels
// can be cut apart cleanly; dedicated label sizes fill the sheet). Shared by the
// PDF builder and the preview so they always agree.
export interface LabelGeometry {
  pw: number; ph: number; cols: number; rows: number;
  cellW: number; cellH: number; gap: number; margin: number;
}
export function labelGeometry(fmt: LabelFormat): LabelGeometry {
  let [pw, ph] = PAPER_PT[fmt.paper] || PAPER_PT['4x6'];
  let [cols, rows] = GRID[fmt.perPage] || [1, 1];
  const isA4 = fmt.paper === 'a4';
  // A4 with 8 labels prints LANDSCAPE as a 4×2 grid (each label a clean portrait card).
  if (isA4 && fmt.perPage === 8) {
    [pw, ph] = [ph, pw]; // landscape
    cols = 4; rows = 2;
  }
  const gap = isA4 ? 18 : 0;    // 0.25in gutter between labels for clean cutting
  const margin = isA4 ? 18 : 6; // outer page margin (thermal labels stay near the edge)
  const cellW = (pw - 2 * margin - (cols - 1) * gap) / cols;
  const cellH = (ph - 2 * margin - (rows - 1) * gap) / rows;
  return { pw, ph, cols, rows, cellW, cellH, gap, margin };
}
export function labelCellOrigin(g: LabelGeometry, col: number, row: number): [number, number] {
  return [g.margin + col * (g.cellW + g.gap), g.margin + row * (g.cellH + g.gap)];
}
// The sensible default count for a paper (A4 → a 2×2 quarter sheet; others → 1).
export function defaultPerPageFor(paper: PaperKey): number {
  return paper === 'a4' ? 4 : 1;
}

const PAPER_LS = 'shipeasy.labelPaper';
const PER_PAGE_LS = 'shipeasy.labelPerPage';
const DEFAULT: LabelFormat = { paper: '4x6', perPage: 1 };

export function getLabelFormat(): LabelFormat {
  try {
    const stored = (localStorage.getItem(PAPER_LS) as PaperKey) || DEFAULT.paper;
    const paper = PAPER_OPTIONS.some((o) => o.key === stored) ? stored : DEFAULT.paper;
    const perStored = Number(localStorage.getItem(PER_PAGE_LS));
    const perPage = perPageOptionsFor(paper).includes(perStored) ? perStored : defaultPerPageFor(paper);
    return { paper, perPage };
  } catch {
    return { ...DEFAULT };
  }
}

export function setLabelFormat(fmt: LabelFormat): void {
  try {
    localStorage.setItem(PAPER_LS, fmt.paper);
    localStorage.setItem(PER_PAGE_LS, String(fmt.perPage));
  } catch {
    /* ignore */
  }
}
