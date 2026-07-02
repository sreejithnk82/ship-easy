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
