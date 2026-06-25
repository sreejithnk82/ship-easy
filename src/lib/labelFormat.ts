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

export const PER_PAGE_OPTIONS = [1, 2, 4, 6, 8];

const PAPER_LS = 'shipeasy.labelPaper';
const PER_PAGE_LS = 'shipeasy.labelPerPage';
const DEFAULT: LabelFormat = { paper: '4x6', perPage: 1 };

export function getLabelFormat(): LabelFormat {
  try {
    const paper = (localStorage.getItem(PAPER_LS) as PaperKey) || DEFAULT.paper;
    const perPage = Number(localStorage.getItem(PER_PAGE_LS)) || DEFAULT.perPage;
    const validPaper = PAPER_OPTIONS.some((o) => o.key === paper) ? paper : DEFAULT.paper;
    const validPer = PER_PAGE_OPTIONS.includes(perPage) ? perPage : DEFAULT.perPage;
    return { paper: validPaper, perPage: validPer };
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
