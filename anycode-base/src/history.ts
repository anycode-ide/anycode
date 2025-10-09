export default class History<T> {
    private index = 0;
    private edits: T[] = [];
    private readonly maxItems: number;

    constructor(maxItems: number = 10000) {
        this.maxItems = maxItems;
    }

    push(item: T): void {
        while (this.edits.length > this.index) {
            this.edits.pop();
        }

        if (this.edits.length === this.maxItems) {
            this.edits.shift();
            if (this.index > 0) this.index--;
        }

        this.edits.push(item);
        this.index++;
    }

    undo(): T | undefined {
        if (this.index === 0) return undefined;
        this.index--;
        return this.edits[this.index];
    }

    redo(): T | undefined {
        if (this.index >= this.edits.length) return undefined;
        const item = this.edits[this.index];
        this.index++;
        return item;
    }

    current(): T | undefined {
        return this.edits[this.index - 1];
    }

    canUndo(): boolean {
        return this.index > 0;
    }

    canRedo(): boolean {
        return this.index < this.edits.length;
    }

    size(): number {
        return this.edits.length;
    }

    clear(): void {
        this.edits = [];
        this.index = 0;
    }
}




