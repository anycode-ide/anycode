export type SearchMatch = { line: number; column: number };

export class Search {
    private searchActive = false;
    private searchPattern = "";
    private searchMatches: SearchMatch[] = [];
    private searchSelected = 0;
    private focused: boolean = false;
    private _needsFocus: boolean = false;

    constructor(){

    }

    public getNeedsFocus(): boolean {
        return this._needsFocus;
    }

    public setNeedsFocus(value: boolean) {
        this._needsFocus = value;
    }

    public isActive(): boolean {
        return this.searchActive;
    }

    public setActive(value: boolean) {
        this.searchActive = value;
    }

    public setFocused(value: boolean) {
        this.focused = value;
    }

    public isFocused(): boolean {
        return this.focused;
    }

    public setPattern(pattern: string) {
        this.searchPattern = pattern;
    }

    public getPattern(): string {
        return this.searchPattern;
    }

    public clear(){
        this.searchActive = false;
        this.searchPattern = "";
        this.searchMatches = [];
        this.searchSelected = 0;
        this.focused = false;
        this._needsFocus = false;
    }

    public setMatches(matches: SearchMatch[]) {
        this.searchMatches = matches;
    }

    public getMatches(): SearchMatch[] {
        return this.searchMatches;
    }

    public getSelected(): number {
        return this.searchSelected;
    }
    public getSelectedMatch(): SearchMatch | null {
        if (
            !this.searchMatches.length ||
            this.searchSelected < 0 ||
            this.searchSelected >= this.searchMatches.length
        ) {
            return null;
        }
        return this.searchMatches[this.searchSelected];
    }

    public setSelected(selected: number) {
        this.searchSelected = selected;
    }

    public selectNext() {
        if (this.searchMatches.length === 0) {
            this.searchSelected = 0;
            return;
        }
        this.searchSelected += 1;
        if (this.searchSelected >= this.searchMatches.length) {
            this.searchSelected = 0;
        }
    }
    public selectPrev() {
        if (this.searchMatches.length === 0) {
            this.searchSelected = 0;
            return;
        }
        this.searchSelected -= 1;
        if (this.searchSelected < 0) {
            this.searchSelected = this.searchMatches.length - 1;
        }
    }
}