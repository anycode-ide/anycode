export default class History<T> {
    private index = 0;
    private items: T[] = [];
    private readonly maxItems: number;

    constructor(maxItems: number = 10000) {
        this.maxItems = maxItems;
    }

    push(item: T): void {
        while (this.items.length > this.index) {
            this.items.pop();
        }

        if (this.items.length === this.maxItems) {
            this.items.shift();
            if (this.index > 0) this.index--;
        }

        this.items.push(item);
        this.index++;
    }

    undo(): T | undefined {
        if (this.index === 0) return undefined;
        this.index--;
        return this.items[this.index];
    }

    redo(): T | undefined {
        if (this.index >= this.items.length) return undefined;
        const item = this.items[this.index];
        this.index++;
        return item;
    }

    current(): T | undefined {
        return this.items[this.index - 1];
    }

    canUndo(): boolean {
        return this.index > 0;
    }

    canRedo(): boolean {
        return this.index < this.items.length;
    }

    size(): number {
        return this.items.length;
    }

    clear(): void {
        this.items = [];
        this.index = 0;
    }
}