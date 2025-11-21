

import { Code, Edit, Change, Position } from "./code";
import { vesper } from './theme';
import { Renderer } from './renderer';
import { getPosFromMouse } from './mouse';
import { Selection } from "./selection";
import { Completion, CompletionRequest, DefinitionRequest, DefinitionResponse } from "./lsp";
import {
    Action, ActionContext, ActionResult, 
    executeAction, handlePasteText,
} from './actions';
import { 
    generateCssClasses, addCssToDocument,
    findPrevWord, findNextWord, 
    getCompletionRange, scoreMatches
} from './utils';

import './styles.css';
import { Search } from "./search";

export interface EditorSettings {
    lineHeight: number;
    buffer: number;
}

export interface EditorState {
    code: Code; 
    offset: number;
    selection: Selection | null;
    runLines: number[];
    errorLines: Map<number, string>;
    settings: EditorSettings;
}

export class AnycodeEditor {
    private code: Code;
    private offset: number;
    private settings: EditorSettings;
    private renderer!: Renderer;
    private container!: HTMLDivElement;
    private buttonsColumn!: HTMLDivElement;
    private gutter!: HTMLDivElement;
    private codeContent!: HTMLDivElement;
    private isFocused: boolean;
    private maxLineWidth = 0;
    
    private isMouseSelecting: boolean = false;
    private selection: Selection | null = null;
    private autoScrollTimer: number | null = null;
    private isWordSelection: boolean = false;
    private wordSelectionAnchor: number = 0;
    
    private lastScrollTop = 0;

    private runLines: number[] = [];
    private errorLines: Map<number, string> = new Map();
    
    private isCompletionOpen = false;
    private selectedCompletionIndex = 0;
    private completions: Completion[] = [];
    private completionProvider: ((request: CompletionRequest) => Promise<Completion[]>) | null = null;
    private goToDefinitionProvider: ((request: DefinitionRequest) => Promise<DefinitionResponse>) | null = null;
    private onCursorChangeCallback: ((newCursor: Position, oldCursor: Position) => void) | null = null;

    private needFocus = false;

    private search: Search = new Search();

    constructor(
        initialText = '', 
        filename: string = 'test.txt', 
        language: string = 'javascript', 
        options: any = {}
    ) {
        this.code = new Code(initialText, filename, language);
        console.log("code constructor, options", options);
        
        // Set initial cursor position
        if (options.line !== undefined && options.column !== undefined) {
            this.offset = this.code.getOffset(options.line, options.column);
            this.needFocus = true;
        } else {
            this.offset = 0;
        }
        
        this.settings = { lineHeight: 20, buffer: 30 };
        
        const theme = options.theme || vesper;
        const css = generateCssClasses(theme);
        addCssToDocument(css, 'anyeditor-theme');
        this.createDomElements();
        this.renderer = new Renderer(this.container, this.buttonsColumn, this.gutter, this.codeContent);
        console.log("code constructor, this.offset", this.offset);
        this.isFocused = true;
    }
    
    private createDomElements() {
        this.container = document.createElement('div');
        this.container.className = 'anyeditor';
        
        this.buttonsColumn = document.createElement('div');
        this.buttonsColumn.className = 'buttons';
        
        this.gutter = document.createElement('div');
        this.gutter.className = 'gutter';
        
        this.codeContent = document.createElement('div');
        this.codeContent.className = 'code';
        this.codeContent.setAttribute("contentEditable", "true");
        this.codeContent.setAttribute("spellcheck", "false");
        this.codeContent.setAttribute("autocorrect", "off");
        this.codeContent.setAttribute("autocapitalize", "off");
        
        this.container.appendChild(this.buttonsColumn);
        this.container.appendChild(this.gutter);
        this.container.appendChild(this.codeContent);
    }

    public clean() {
        console.log('clean');
        this.removeEventListeners();
        this.offset = 0;
        this.selection = null;
        
        if (this.container && this.container.parentElement) {
            this.container.parentElement.removeChild(this.container);
        }
    }

    public setOnChange(func: (t: Change) => void ) {
        this.code.setOnChange(func);
    }
    
    public setText(newText: string) {
        this.code.setContent(newText);
    }

    public getText(): string {
        return this.code.getContent();
    }

    public async init() {
        await this.code.init();
        this.setupEventListeners();
    }

    public getContainer(): HTMLDivElement {
        return this.container;
    }

    public getCursor(): { line: number, column: number } {
        return this.code.getPosition(this.offset);
    }

    public setCursor(line: number, column: number): void {
        const offset = this.code.getOffset(line, column);
        this.offset = offset;
        this.renderer.renderCursor(line, column);
    }

    public requestFocus(line: number, column: number, center: boolean = false): void {
        this.needFocus = true;
        const offset = this.code.getOffset(line, column);
        this.offset = offset;
        this.codeContent.focus();

        if (center) this.renderer.focusCenter(this.getEditorState());
        else this.renderer.focus(this.getEditorState());

        this.renderer.renderCursorOrSelection(this.getEditorState());
    }

    public requestedFocus(): boolean {
        return this.needFocus;
    }

    public setRunButtonLines(lines: number[]) {
        this.runLines = lines;
    }

    public setErrors(errors: { line: number, message: string }[]) {
        this.errorLines.clear();
        for (const { line, message } of errors) {
            this.errorLines.set(line, message);
        }
        this.renderer.renderErrors(this.errorLines);
    }
    
    public setCompletions(completions: Completion[]) {
        this.completions = completions;
    }

    public setCompletionProvider(
        completionProvider: (request: CompletionRequest) => Promise<Completion[]>
    ) {
        this.completionProvider = completionProvider;
    }

    public setGoToDefinitionProvider(
        goToDefinitionProvider: (request: DefinitionRequest) => Promise<DefinitionResponse>
    ) {
        this.goToDefinitionProvider = goToDefinitionProvider;
    }

    public setOnCursorChange(callback: (newState: Position, oldState: Position) => void) {
        this.onCursorChangeCallback = callback;
    }

    private setupEventListeners() {        
        this.handleScroll = this.handleScroll.bind(this);
        this.container.addEventListener("scroll", this.handleScroll);
        
        this.handleClick = this.handleClick.bind(this);
        this.codeContent.addEventListener('click', this.handleClick);
        
        this.handleKeydown = this.handleKeydown.bind(this);
        this.codeContent.addEventListener('keydown', this.handleKeydown);

        this.handlePasteEvent = this.handlePasteEvent.bind(this);
        this.codeContent.addEventListener('paste', this.handlePasteEvent);
        
        this.handleBeforeInput = this.handleBeforeInput.bind(this);
        this.container.addEventListener('beforeinput', this.handleBeforeInput);
        
        this.handleMouseDown = this.handleMouseDown.bind(this);
        this.codeContent.addEventListener('mousedown', this.handleMouseDown);

        this.handleMouseUp = this.handleMouseUp.bind(this);
        this.container.addEventListener('mouseup', this.handleMouseUp);
        
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.container.addEventListener('mousemove', this.handleMouseMove);

        this.handleBlur = this.handleBlur.bind(this);
        this.codeContent.addEventListener('blur', this.handleBlur);

        this.handleFocus = this.handleFocus.bind(this);
        this.codeContent.addEventListener('focus', this.handleFocus);
    }
    
    private removeEventListeners() {
        this.container.removeEventListener("scroll", this.handleScroll);
        this.codeContent.removeEventListener('click', this.handleClick);
        this.codeContent.removeEventListener('keydown', this.handleKeydown);
        this.codeContent.removeEventListener('paste', this.handlePasteEvent);
        this.container.removeEventListener('beforeinput', this.handleBeforeInput);
        this.codeContent.removeEventListener('mousedown', this.handleMouseDown);
        this.container.removeEventListener('mouseup', this.handleMouseUp);
        this.container.removeEventListener('mousemove', this.handleMouseMove);
        this.codeContent.removeEventListener('blur', this.handleBlur);
    }

    private handleScroll() {
        const scrollTop = this.container.scrollTop;
        requestAnimationFrame(() => {
            if (scrollTop !== this.lastScrollTop) {
                let state = this.getEditorState();
                this.renderer.renderScroll(state, this.search);
                this.lastScrollTop = scrollTop;
            }
            this.needFocus = false
        });
    }

    public hasScroll() {
        return this.lastScrollTop !== 0;
    }

    public restoreScroll() {
        this.container.scrollTop = this.lastScrollTop;
    }

    private getEditorState(): EditorState {
        return {
            code: this.code,
            offset: this.offset,
            selection: this.selection,
            runLines: this.runLines,
            errorLines: this.errorLines,
            settings: {
                lineHeight: this.settings.lineHeight,
                buffer: this.settings.buffer,
            },
        };
    }

    public render() {
        this.renderer.render(this.getEditorState(), this.search);
    }

    public renderCursorOrSelection() {
        this.renderer.renderCursorOrSelection(this.getEditorState());
    }
    
    private handleClick(e: MouseEvent): void {
        const oldCursor = this.code.getPosition(this.offset);

        if (this.selection && this.selection.nonEmpty()) { return; }
        
        e.preventDefault();
        
        const pos = getPosFromMouse(e);
        if (!pos) { return; }


        const o = this.code.getOffset(pos.row, pos.col);
        if (o == this.offset) { return; }

        this.offset = o;
        
        const { line, column } = this.code.getPosition(this.offset);
        this.renderer.renderCursor(line, column);

        if (this.onCursorChangeCallback) {
            this.onCursorChangeCallback({ line, column }, oldCursor);
        }

        if (this.isCompletionOpen){
            this.renderer.closeCompletion();
            this.isCompletionOpen = false;
        }

        if (e.metaKey || e.ctrlKey) {
            this.goToDefinition(pos.row, pos.col).catch(console.error);
        }
    }

    private async goToDefinition(row: number, col: number): Promise<void> {
        if (!this.goToDefinitionProvider) {
            console.warn('Go to definition provider not set');
            return;
        }

        try {
            const definitionRequest: DefinitionRequest = {
                file: this.code.filename,
                row: row,
                column: col
            };

            await this.goToDefinitionProvider(definitionRequest);
        } catch (error) {
            console.error('Failed to get definition:', error);
        }
    }
    
    private handleMouseUp(e: MouseEvent) {
        // console.log('handleMouseUp ', this.selection);
        this.isMouseSelecting = false;
        this.isWordSelection = false;
        
        if (this.autoScrollTimer) {
            cancelAnimationFrame(this.autoScrollTimer);
            this.autoScrollTimer = null;
        }
    }

    private handleBlur(e: FocusEvent) {
        console.log('Editor lost focus');
        this.isMouseSelecting = false;
        this.isWordSelection = false;
        this.isFocused = false;
        
        if (this.autoScrollTimer) {
            cancelAnimationFrame(this.autoScrollTimer);
            this.autoScrollTimer = null;
        }
    }

    private handleFocus(e: FocusEvent) {
        console.log('Editor focus');
        this.isFocused = true;
        this.search.setNeedsFocus(false);
    }
    
    private handleMouseDown(e: MouseEvent) {
        if (e.button !== 0) return;
        e.preventDefault();
    
        this.isMouseSelecting = true;
    
        const pos = getPosFromMouse(e);
        if (!pos) return;
    
        if (e.detail === 2) { // double click
            this.selectWord(pos.row, pos.col);
            this.isWordSelection = true;
            this.wordSelectionAnchor = this.code.getOffset(pos.row, pos.col);
            return;
        }
        
        if (e.detail === 3) { // triple click
            this.selectLine(pos.row);
            return;
        }
    
        this.isWordSelection = false;
        const o = this.code.getOffset(pos.row, pos.col);
    
        if (e.shiftKey && this.selection) {
            this.selection.updateCursor(o);
            this.renderer.renderSelection(this.code, this.selection);
        } else {
            if (this.selection) {
                this.selection.reset(o);
            } else {
                this.selection = new Selection(o, o);
            }
        }
    }
    
    private handleMouseMove(e: MouseEvent) {        
        e.preventDefault();
        if (!this.isMouseSelecting) return;
        
        this.autoScroll(e);
        
        let pos = getPosFromMouse(e);

        let oldSelection = this.selection?.clone();
        
        if (pos && this.selection) {
            const { row, col } = pos;
            const currentOffset = this.code.getOffset(row, col);
        
            if (this.isWordSelection) {
                const line = this.code.line(row);
                const currentPos = this.code.getPosition(currentOffset);
        
                const anchor = this.wordSelectionAnchor;
                const anchorPos = this.code.getPosition(anchor);
                const anchorLine = this.code.line(anchorPos.line);
        
                const direction = currentOffset < anchor ? 'backward' : 'forward';
        
                if (direction === 'backward') {
                    // Selection is moving left (backward) — find start of current word
                    const wordStartCol = findPrevWord(line, currentPos.column);
                    const newCursor = this.code.getOffset(row, wordStartCol);
        
                    // Extend selection to the end of the anchor word
                    const anchorEndCol = findNextWord(anchorLine, anchorPos.column);
                    const anchorEnd = this.code.getOffset(anchorPos.line, anchorEndCol);
        
                    // Update selection from new word start to anchor word end
                    this.selection = new Selection(newCursor, anchorEnd);
                    this.offset = newCursor;
                } else if (direction === 'forward') {
                    // Selection is moving right (forward) — find end of current word
                    const wordEndCol = findNextWord(line, currentPos.column);
                    const newCursor = this.code.getOffset(row, wordEndCol);
        
                    // Extend selection from the start of the anchor word
                    const anchorStartCol = findPrevWord(anchorLine, anchorPos.column);
                    const anchorStart = this.code.getOffset(anchorPos.line, anchorStartCol);
        
                    // Update selection from anchor word start to new word end
                    this.selection = new Selection(anchorStart, newCursor);
                    this.offset = newCursor;
                } else {
                    // Cursor hasn't moved — select the current word under cursor
                    const startCol = findPrevWord(line, currentPos.column);
                    const endCol = findNextWord(line, currentPos.column);
                    const start = this.code.getOffset(row, startCol);
                    const end = this.code.getOffset(row, endCol);
        
                    this.selection = new Selection(start, end);
                    this.offset = end;
                }
            } else {
                // Standard selection mode — update the cursor directly
                this.selection.updateCursor(currentOffset);
            }
            
            if (oldSelection && !oldSelection.equals(this.selection)) {
                // console.log('selection changed');
                this.renderer.renderSelection(this.code, this.selection);
            }
        }
    }

    private autoScroll(e: MouseEvent) {
        const containerRect = this.container.getBoundingClientRect();
        const mouseY = e.clientY;
        const scrollThreshold = 20; // pixels from edge to trigger scroll
        const scrollSpeed = 5; // pixels to scroll per frame
        
        // Clear existing timer
        if (this.autoScrollTimer) {
            cancelAnimationFrame(this.autoScrollTimer);
            this.autoScrollTimer = null;
        }
        
        let shouldScroll = false;
        let scrollDirection = 0;
        
        // Check if mouse is near the top or bottom edge
        if (mouseY < containerRect.top + scrollThreshold) {
            shouldScroll = true;
            scrollDirection = -1; // scroll up
        } else if (mouseY > containerRect.bottom - scrollThreshold) {
            shouldScroll = true;
            scrollDirection = 1; // scroll down
        }
        
        if (shouldScroll) {
            const autoScroll = () => {
                if (!this.isMouseSelecting) return;
                
                const currentScroll = this.container.scrollTop;
                const maxScroll = this.container.scrollHeight - this.container.clientHeight;
                
                if (scrollDirection === -1) {  // Scroll up
                    this.container.scrollTop = Math.max(0, currentScroll - scrollSpeed);
                } else {  // Scroll down
                    this.container.scrollTop = Math.min(maxScroll, currentScroll + scrollSpeed);
                }
                // Continue scrolling if still selecting
                if (this.isMouseSelecting) {
                    this.autoScrollTimer = requestAnimationFrame(autoScroll);
                }
            };
            this.autoScrollTimer = requestAnimationFrame(autoScroll);
        }
    }
    
    private selectWord(row: number, col: number) {
        const line = this.code.line(row); 
    
        const startCol = findPrevWord(line, col);
        const endCol = findNextWord(line, col);
    
        const start = this.code.getOffset(row, startCol);
        const end = this.code.getOffset(row, endCol);
    
        this.selection = new Selection(start, end);
        
        this.offset = end;
        console.log('selectWord', end);
        this.renderer.renderSelection(this.code, this.selection);
    }
    
    private selectLine(row: number) {
        const lineLen = this.code.lineLength(row);
        const start = this.code.getOffset(row, 0);
        const end = this.code.getOffset(row, lineLen);
    
        this.selection = new Selection(start, end);
    
        this.offset = end;
        console.log('selectLine', end);
        this.renderer.renderSelection(this.code, this.selection);
    }
    
    private async handleKeydown(event: KeyboardEvent) {
        console.log('keydown', event);

        if (event.metaKey && event.key === " ") {
            event.preventDefault();
            this.toggleCompletion();
            return;
        }
    
        if (event.metaKey && event.key === "f" || this.search.isFocused()) {
            event.preventDefault();
            this.handleSearchKey(event);
            return;
        }

        if (this.handleCompletionKey(event)) {
            event.preventDefault();
            return;
        }
        
        const action = this.getActionFromKey(event);
        if (!action) return;
        
        // Special-case paste in non-secure context: let native paste flow,
        // which will be handled by the 'beforeinput' listener.
        if (action === Action.PASTE && !(navigator.clipboard && window.isSecureContext)) {
            return;
        }

        // Special-case go to definition: handle directly
        if (action === Action.GO_TO_DEFINITION) {
            event.preventDefault();
            const { line, column } = this.code.getPosition(this.offset);
            this.goToDefinition(line, column).catch(console.error);
            return;
        }

        event.preventDefault();
        
        const ctx: ActionContext = {
            offset: this.offset,
            code: this.code,
            selection: this.selection || undefined,
            event: event
        };
        
        const result = await executeAction(action, ctx);
        this.applyEditResult(result);

        if (this.isCompletionOpen){
            await this.showCompletion();
        }
        
        if (this.search.isActive() && action === Action.ESC) {
            this.renderer.removeAllHighlights(this.search);
            this.renderer.removeSearch();
            this.search.clear();
        }
    }
    
    private getActionFromKey(event: KeyboardEvent): Action | null {
        const { key, altKey, ctrlKey, metaKey, shiftKey } = event;

        // Shortcuts
        if (metaKey) {
            if (shiftKey && key.toLowerCase() === 'z') 
                return Action.REDO;
            if (key.toLowerCase() === '/') 
                    return Action.COMMENT;
            
            switch (key.toLowerCase()) {
                case 'z': return Action.UNDO;
                case 'a': return Action.SELECT_ALL;
                case 'c': return Action.COPY;
                case 'v': return Action.PASTE;
                case 'x': return Action.CUT;
                case 'd': return Action.DUPLICATE;
                default: return null;
            }
        }
        
        // Navigation
        if (altKey) {
            switch (key) {
                case "ArrowLeft": return Action.ARROW_LEFT_ALT;
                case "ArrowRight": return Action.ARROW_RIGHT_ALT;
            }
        } else {
            switch (key) {
                case "ArrowLeft": return Action.ARROW_LEFT;
                case "ArrowRight": return Action.ARROW_RIGHT;
                case "ArrowUp": return Action.ARROW_UP;
                case "ArrowDown": return Action.ARROW_DOWN;
            }
        } 
        
        // Editing
        if (shiftKey && key === 'Tab') {
            return Action.UNTAB;
        } 
        
        switch (key) {
            case "Backspace": return Action.BACKSPACE;
            case "Delete": return Action.DELETE;
            case "Enter": return Action.ENTER;
            case "Tab": return Action.TAB;
            case "Escape": return Action.ESC;
            case "F12": return Action.GO_TO_DEFINITION;
        }
        
        // Text input
        if (key.length === 1 && !ctrlKey) {
            return Action.TEXT_INPUT;
        }
        
        return null;
    }
    
    private applyEditResult(result: ActionResult) {
        const textChanged = result.changed;
        const offsetChanged = result.ctx.offset !== this.offset;
        const selectionChanged = this.selection !== result.ctx.selection;
        
        if (!textChanged && !offsetChanged && !selectionChanged) return;
    
        if (textChanged) this.code = result.ctx.code;
        if (offsetChanged) this.offset = result.ctx.offset;
        if (selectionChanged) this.selection = result.ctx.selection || null;
    
        const state = this.getEditorState();
        const focused = this.renderer.focus(state);
    
        if (textChanged) {
            let matches = this.code.search(this.search.getPattern());
            this.search.setMatches(matches);
            if (!focused) this.renderer.renderChanges(state, this.search);
        } else if (offsetChanged || selectionChanged) {
            if (!focused) this.renderer.renderCursorOrSelection(state);
        }
    }
    
    private async handleBeforeInput(e: InputEvent) {
        // this one is for mobile devices, support input and deletion
        e.preventDefault();
        e.stopPropagation();

        if (e.inputType === 'deleteContentBackward') {
            const ctx: ActionContext = {
                offset: this.offset,
                code: this.code,
                selection: this.selection || undefined,
            };
            const result = await executeAction(Action.BACKSPACE, ctx);
            this.applyEditResult(result);
            return;
        } else if (e.inputType === 'deleteContentForward') {
        } else if (e.inputType.startsWith('delete')) {
        } else {
            // Default case for insertion or other input events
            let key = e.data ?? '';
            if (key === '') return;
            
            const ctx: ActionContext = {
                offset: this.offset,
                code: this.code,
                selection: this.selection || undefined,
                event: { key } as KeyboardEvent
            };
            
            const result = await executeAction(Action.TEXT_INPUT, ctx);
            this.applyEditResult(result);
        }
    }
    
    private handlePasteEvent(e: ClipboardEvent) {
        // In secure contexts, paste is handled via Action.PASTE using navigator.clipboard
        if (navigator.clipboard && window.isSecureContext) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const pastedText = e.clipboardData?.getData('text/plain') ?? '';
        if (!pastedText) return;

        const ctx: ActionContext = {
            offset: this.offset,
            code: this.code,
            selection: this.selection || undefined,
        };

        let result = handlePasteText(ctx, pastedText);
        this.applyEditResult(result);
    }
    
    public async toggleCompletion() {
        console.log('anycode: toggle completion');

        if (this.isCompletionOpen) {
            this.renderer.closeCompletion();
            this.isCompletionOpen = false;
            return;
        }

        await this.showCompletion();
    }

    public async showCompletion() {
        if (!this.completionProvider) return;

        let { line, column } = this.code.getPosition(this.offset);

        let newCompletions = await this.completionProvider({
            file: this.code.filename, row: line, column: column
        });

        if (newCompletions.length === 0) {
            this.completions = [];
            this.renderer.closeCompletion();
            this.isCompletionOpen = false;
            return;
        }

        let lineStr = this.code.line(line);
        let prev = findPrevWord(lineStr, column)
        let prevWord = lineStr.substring(prev, column)

        newCompletions.sort((a, b) => {
            let sa = scoreMatches(a.label, prevWord);
            let sb = scoreMatches(b.label, prevWord);
            if (sa === sb) return a.label.length - b.label.length;
            else return sb - sa;
        });

        this.completions = newCompletions;
        this.selectedCompletionIndex = 0;
        
        this.renderer.renderCompletion(
            this.completions, this.selectedCompletionIndex, 
            this.code, this.offset, 
            this.applyCompletion.bind(this)
        );
        this.isCompletionOpen = true;
    }

    public applyCompletion(index: number) {
        if (index < 0 || index >= this.completions.length) return;
        if (!this.isCompletionOpen) return;

        let { line, column } = this.code.getPosition(this.offset);
        let completionItem = this.completions[index];
        let text = completionItem.label;
        
        let lineStr = this.code.line(line);
        
        let { start: replaceStart, end: replaceEnd } = getCompletionRange(lineStr, column);

        this.code.tx();
        this.code.setStateBefore(this.offset, this.selection || undefined);
        let startOffset = this.code.getOffset(line, replaceStart);
        let endOffset = this.code.getOffset(line, replaceEnd);
        this.code.remove(startOffset, endOffset - startOffset);
        this.code.insert(text, startOffset);
        this.offset = startOffset + text.length;
        this.code.setStateAfter(this.offset, this.selection || undefined);
        this.code.commit();

        this.renderer.closeCompletion();
        this.isCompletionOpen = false;
        this.renderer.renderChanges(this.getEditorState(), this.search);
    }

    private handleCompletionKey(event: KeyboardEvent): boolean {
        if (!this.isCompletionOpen) return false;

        let completionsCount = this.completions.length;

        if (event.key === "ArrowDown") {
            const next = (this.selectedCompletionIndex + 1) % completionsCount;
            this.selectedCompletionIndex = next;
            this.renderer.highlightCompletion(next);
            return true;
        }

        if (event.key === "ArrowUp") {
            const prev = (this.selectedCompletionIndex - 1 + completionsCount) % completionsCount;
            this.selectedCompletionIndex = prev;
            this.renderer.highlightCompletion(prev);
            return true;
        }

        if (event.key === "Enter") {
            this.applyCompletion(this.selectedCompletionIndex);
            return true;
        }

        if (event.key === "Escape") {
            this.renderer.closeCompletion();
            this.isCompletionOpen = false;
            return true;
        }

        return false;
    }

    private handleSearchKey(event: KeyboardEvent): boolean {
        const { key, altKey, ctrlKey, metaKey, shiftKey } = event;
        let isSearch = false;

        if (metaKey && key.toLowerCase() == 'f') {
            this.renderer.removeAllHighlights(this.search);
        
            this.search.setActive(true);
            this.search.setNeedsFocus(true);
            let pattern = this.search.getPattern();

            if (this.selection && !this.selection.isEmpty()) {
                let [start, end] = this.selection!.sorted();
                let content = this.code.getIntervalContent2(start, end);
                pattern = content;
            }
            
            let matches = this.code.search(pattern);
            this.search.setPattern(pattern);
            this.search.setMatches(matches);

            // Find the first match
            let { line, column } = this.code.getPosition(this.offset);
            let foundIndex = matches.findIndex((match) => match.line > line || 
                (match.line === line && match.column + pattern.length >= column)
            );
            if (foundIndex === -1 && matches.length > 0) { foundIndex = 0; }
            this.search.setSelected(foundIndex);

            this.renderer.renderSearch(this.search, this.getEditorState(), {
                onKeyDown: this.onSearchKeyDown.bind(this),
                onInputChange: this.onSearchInputChange.bind(this)
            });
            isSearch = true;
        }
        

        if (event.key === "Escape" && this.search.isActive()) {    
            this.renderer.removeAllHighlights(this.search);
            this.renderer.removeSearch();
            this.search.clear();
            isSearch = false;
        }

        return isSearch;
    }

    private onSearchKeyDown(event: KeyboardEvent, input: HTMLTextAreaElement) {
        console.log('[onSearchKeyDown]', {
            key: event.key,
            pattern: this.search.getPattern(),
            matches: this.search.getMatches(),
            selected: this.search.getSelected(),
        });

        const pattern = this.search.getPattern();
        const patternLines = pattern.split(/\r?\n/);
        const isMultiline = patternLines.length > 1;

        if (event.metaKey && event.key === 'f') {
            event.preventDefault();
            event.stopPropagation();
            // ignore search  
            return
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.renderer.removeAllHighlights(this.search);
            this.renderer.removeSearch();
            this.search.clear();
            this.renderer.renderCursorOrSelection(this.getEditorState());
            return;
        }

        if ((event.altKey || !isMultiline) && event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            const currentMatches = this.search.getMatches();
            if (currentMatches.length === 0) return;
            this.renderer.removeSelectedHighlight(this.search);
            this.search.selectPrev();
            this.search.setNeedsFocus(true);
            this.renderer.focus(this.getEditorState(), this.search.getSelectedMatch()?.line);
            this.renderer.updateSearchHighlights(this.search);
            return;
        }

        if ((event.altKey || !isMultiline) && event.key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            const currentMatches = this.search.getMatches();
            if (currentMatches.length === 0) return;
            this.renderer.removeSelectedHighlight(this.search);
            this.search.selectNext();
            this.search.setNeedsFocus(true);
            this.renderer.focus(this.getEditorState(), this.search.getSelectedMatch()?.line);
            this.renderer.updateSearchHighlights(this.search);
            return;
        }

        if (!event.shiftKey && event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            const selectedMatch = this.search.getSelectedMatch();
            if (selectedMatch) {
                this.renderer.removeAllHighlights(this.search);
                this.renderer.removeSearch();
                let start = this.code.getOffset(selectedMatch.line, selectedMatch.column);
                let end = start + this.search.getPattern().length;
                this.offset = end;
                this.selection = new Selection(start, end);
                this.search.clear();
                this.container.focus();
                let focused = this.renderer.focus(this.getEditorState(), selectedMatch.line);
                if (!focused) this.renderer.renderCursorOrSelection(this.getEditorState());
            }
            return;
        }
    }

    private onSearchInputChange(pattern: string) {
        // Clear everything
        this.renderer.removeAllHighlights(this.search);
        
        if (!pattern) {
            this.renderer.updateSearchLabel('');
            this.search.clear();
            this.search.setActive(false);
            this.search.setNeedsFocus(false);
            return;
        }
    
        // Perform search
        const matches = this.getEditorState().code.search(pattern);
        this.search.clear();
        this.search.setActive(true);
        this.search.setMatches(matches);
        this.search.setPattern(pattern);    
    
        // Find first match after cursor
        const { line, column } = this.code.getPosition(this.offset);
        let foundIndex = matches.findIndex((match) =>
            match.line > line ||
            (match.line === line && match.column >= column)
        );
        if (foundIndex === -1 && matches.length > 0) {
            foundIndex = 0;
        }
    
        this.search.setSelected(foundIndex);
        this.renderer.updateSearchHighlights(this.search);
        this.search.setNeedsFocus(true);
    }
}