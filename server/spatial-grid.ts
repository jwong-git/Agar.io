// Uniform-grid spatial index. Bucketing is O(1) per insert; range queries visit
// only the buckets overlapping the query rect, so we avoid scanning all N items.
export class SpatialGrid<T extends { x: number; y: number }> {
  private buckets: T[][];
  private cols: number;
  private rows: number;
  private cellSize: number;

  constructor(worldWidth: number, worldHeight: number, cellSize: number) {
    this.cellSize = cellSize;
    this.cols = Math.max(1, Math.ceil(worldWidth / cellSize));
    this.rows = Math.max(1, Math.ceil(worldHeight / cellSize));
    this.buckets = Array.from({ length: this.cols * this.rows }, () => []);
  }

  clear(): void {
    for (const b of this.buckets) b.length = 0;
  }

  rebuild(items: Iterable<T>): void {
    this.clear();
    for (const item of items) {
      this.buckets[this.bucketIndex(item.x, item.y)].push(item);
    }
  }

  forEachInRange(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    fn: (item: T) => void,
  ): void {
    const cx0 = Math.max(0, Math.floor(x0 / this.cellSize));
    const cy0 = Math.max(0, Math.floor(y0 / this.cellSize));
    const cx1 = Math.min(this.cols - 1, Math.floor(x1 / this.cellSize));
    const cy1 = Math.min(this.rows - 1, Math.floor(y1 / this.cellSize));
    for (let cy = cy0; cy <= cy1; cy++) {
      const row = cy * this.cols;
      for (let cx = cx0; cx <= cx1; cx++) {
        const bucket = this.buckets[row + cx];
        for (let i = 0; i < bucket.length; i++) fn(bucket[i]);
      }
    }
  }

  private bucketIndex(x: number, y: number): number {
    const cx = Math.max(
      0,
      Math.min(this.cols - 1, Math.floor(x / this.cellSize)),
    );
    const cy = Math.max(
      0,
      Math.min(this.rows - 1, Math.floor(y / this.cellSize)),
    );
    return cy * this.cols + cx;
  }
}
