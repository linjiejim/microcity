/** 最小堆：按 (t, prio, seq) 排序，同一时刻的先后由显式优先级与入队序号裁决。 */
export interface Keyed {
  t: number;
  prio: number;
  seq: number;
}

const less = (a: Keyed, b: Keyed) => a.t < b.t || (a.t === b.t && (a.prio < b.prio || (a.prio === b.prio && a.seq < b.seq)));

export class MinHeap<T extends Keyed> {
  private items: T[] = [];

  get size(): number {
    return this.items.length;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  push(item: T): void {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(a[i]!, a[p]!)) break;
      [a[i], a[p]] = [a[p]!, a[i]!];
      i = p;
    }
  }

  pop(): T | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && less(a[l]!, a[m]!)) m = l;
        if (r < a.length && less(a[r]!, a[m]!)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }

  /** 删除满足条件的元素（用于取消任务），O(n) */
  removeWhere(pred: (x: T) => boolean): number {
    const kept = this.items.filter((x) => !pred(x));
    const removed = this.items.length - kept.length;
    if (removed > 0) {
      this.items = [];
      for (const x of kept) this.push(x);
    }
    return removed;
  }

  toArray(): T[] {
    return [...this.items].sort((a, b) => (less(a, b) ? -1 : less(b, a) ? 1 : 0));
  }

  static from<T extends Keyed>(items: T[]): MinHeap<T> {
    const h = new MinHeap<T>();
    for (const x of items) h.push(x);
    return h;
  }
}
