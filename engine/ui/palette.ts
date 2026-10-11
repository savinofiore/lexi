// Distinct on dark and light terminals; a type keeps its color across sessions.
export const PALETTE: readonly string[] = ['#4fc3f7', '#ffb74d', '#81c784', '#ba68c8', '#e57373', '#fff176', '#4db6ac', '#f06292']

// djb2: a stable string hash, so the same subagent type always lands on the same color.
const hashOf = (text: string): number => [...text].reduce((hash, char) => ((hash * 33) ^ char.charCodeAt(0)) >>> 0, 5381)

export const colorOf = (type: string): string => PALETTE[hashOf(type) % PALETTE.length] ?? PALETTE[0]!
