/**
 * A 5×5 mirrored block avatar seeded by the address, kept to the brand's
 * green–teal range, so the same wallet wears the same face in the app and
 * in its videos.
 */
export interface Identicon {
  background: string;
  foreground: string;
  /** 5 rows × 5 columns, mirrored left to right. */
  cells: boolean[][];
}

function hash(text: string): number {
  let value = 2_166_136_261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16_777_619);
  }
  return value >>> 0;
}

export function identicon(wallet: string): Identicon {
  let seed = hash(wallet) || 1;
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4_294_967_296;
  };
  const hue = 150 + next() * 34;
  const background = `hsl(${hue.toFixed(0)}, 42%, 13%)`;
  const foreground = `hsl(${(hue + next() * 12).toFixed(0)}, 88%, ${(52 + next() * 14).toFixed(0)}%)`;
  const cells = Array.from({ length: 5 }, () => Array<boolean>(5).fill(false));
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      if (next() < 0.5) continue;
      cells[row]![column] = true;
      cells[row]![4 - column] = true;
    }
  }
  return { background, foreground, cells };
}
