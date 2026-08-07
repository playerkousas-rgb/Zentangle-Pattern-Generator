/**
 * 圖案清單。自動掃描 src/assets/patterns/*.svg，
 * 新增或刪除 SVG 檔案時 UI 會自動同步，不需要改死寫的數量。
 */
const files = import.meta.glob('../assets/patterns/*.svg', { eager: true, query: '?url', import: 'default' });

function toEntry(path, url) {
  const name = path.split('/').pop().replace(/\.svg$/i, '');
  return { key: name, url };
}

const all = Object.entries(files).map(([path, url]) => toEntry(path, url));

const blank = all.find((p) => p.key.toLowerCase() === 'blank');
const numbered = all
  .filter((p) => /^\d+$/.test(p.key))
  .sort((a, b) => Number(a.key) - Number(b.key));
const others = all
  .filter((p) => p !== blank && !/^\d+$/.test(p.key))
  .sort((a, b) => a.key.localeCompare(b.key));

export const PATTERNS = [
  { name: '空白', url: blank?.url ?? '', isBlank: true },
  ...numbered.map((p) => ({ name: `圖案 ${p.key}`, url: p.url })),
  ...others.map((p) => ({ name: p.key, url: p.url })),
];

export const BLANK_INDEX = 0;
