import { sha256Hex } from "./crypto.js";

const hashPair = (left: string, right: string): string =>
  sha256Hex(Buffer.from(`${left}:${right}`, "utf8"));

export const computeMerkleRoot = (leaves: string[]): string => {
  if (leaves.length === 0) {
    throw new Error("Cannot compute a Merkle root with no leaves");
  }

  let level = [...leaves];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? left;
      next.push(hashPair(left, right));
    }
    level = next;
  }

  return level[0];
};

export const buildMerkleProof = (leaves: string[], index: number): string[] => {
  if (index < 0 || index >= leaves.length) {
    throw new Error(`Leaf index ${index} is out of bounds`);
  }

  const proof: string[] = [];
  let level = [...leaves];
  let cursor = index;

  while (level.length > 1) {
    const siblingIndex = cursor ^ 1;
    proof.push(level[siblingIndex] ?? level[cursor]);

    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? left;
      next.push(hashPair(left, right));
    }

    cursor = Math.floor(cursor / 2);
    level = next;
  }

  return proof;
};
