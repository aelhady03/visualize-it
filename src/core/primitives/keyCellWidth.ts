// Approximate rendered width of a KeyCell from its text content.
// Lives in its own file so KeyCell.tsx only exports components
// (react-refresh/only-export-components).

export function keyCellWidth(label: string, value?: string, seq?: number | string): number {
  const text = `${label}${value ? `→${value}` : ''}${seq !== undefined ? `${seq}` : ''}`
  return Math.max(28, text.length * 7.4 + 18)
}
