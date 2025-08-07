import { Code, HighlighedNode } from "./code";
import { 
    generateCssClasses, addCssToDocument, isCharacter,
    AnycodeLine as AnycodeLine, Pos,
    minimize, objectHash,
    findPrevWord, findNextWord
} from './utils';

import { vesper } from './theme';
import {
    Action, ActionContext, ActionResult, executeAction
} from './actions';
import {
    getPosFromMouse
} from './mouse';

import { 
    removeCursor, moveCursor
} from './cursor';

import {
    Selection, getSelection,
    setSelectionFromOffsets as renderSelection,
} from "./selection";

import './styles.css';


export class AnycodeEditor {
    private code: Code;
    private offset: number;
    
    private settings: {
        lineHeight: number;
        buffer: number;
    };
    
    private container!: HTMLDivElement;
    private buttonsColumn!: HTMLDivElement;
    private gutter!: HTMLDivElement;
    private codeContent!: HTMLDivElement;
    
    private isMouseSelecting: boolean = false;
    private selection: Selection | null = null;
    private autoScrollTimer: number | null = null;
    private ignoreNextSelectionSet: boolean = false;
    private isWordSelection: boolean = false;
    private wordSelectionAnchor: number = 0;
    
    private isRenderPending = false;
    private lastScrollTop = 0;

    private runLines: number[] = [];
    private errorLines: Map<number, string> = new Map();
    
    private completionContainer: HTMLDivElement | null = null;
    private selectedCompletionIndex = 0;
    private completions: string[] = [];

    constructor(initialText = '', options: any = {}) {
        this.offset = 0;
        this.code = new Code(initialText, "test", "javascript");
        this.settings = { lineHeight: 20, buffer: 20 };
        
        const theme = options.theme || vesper;
        const css = generateCssClasses(theme);
        addCssToDocument(css, 'anyeditor-theme');
        
        this.createDomElements()
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

    public setText(newText: string) {
        this.code.setContent(newText);
    }

    public async init() {
        await this.code.init();
        this.setupEventListeners();
    }

    public getContainer(): HTMLDivElement {
        return this.container;
    }

    public setRunButtonLines(lines: number[]) {
        this.runLines = lines;
    }

    public setErrors(errors: { line: number, message: string }[]) {
        this.errorLines.clear();
        for (const { line, message } of errors) {
            this.errorLines.set(line, message);
        }
    }
    
    public setCompletions(completions: string[]) {
        this.completions = completions;
    }

    private setupEventListeners() {        
        this.handleScroll = this.handleScroll.bind(this);
        this.container.addEventListener("scroll", this.handleScroll);
        
        this.handleClick = this.handleClick.bind(this);
        this.codeContent.addEventListener('click', this.handleClick);
        
        this.handleKeydown = this.handleKeydown.bind(this);
        this.codeContent.addEventListener('keydown', this.handleKeydown);
        
        this.handleBeforeInput = this.handleBeforeInput.bind(this);
        this.container.addEventListener('beforeinput', this.handleBeforeInput);
        
        this.handleMouseDown = this.handleMouseDown.bind(this);
        this.codeContent.addEventListener('mousedown', this.handleMouseDown);

        this.handleMouseUp = this.handleMouseUp.bind(this);
        this.codeContent.addEventListener('mouseup', this.handleMouseUp);
        
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.codeContent.addEventListener('mousemove', this.handleMouseMove);
        
        this.handleSelectionChange = this.handleSelectionChange.bind(this);
        document.addEventListener('selectionchange', this.handleSelectionChange);
    }
    
    private removeEventListeners() {
        this.container.removeEventListener("scroll", this.handleScroll);
        this.codeContent.removeEventListener('click', this.handleClick);
        this.codeContent.removeEventListener('keydown', this.handleKeydown);
        this.container.removeEventListener('beforeinput', this.handleBeforeInput);
        this.codeContent.removeEventListener('mousedown', this.handleMouseDown);
        this.codeContent.removeEventListener('mouseup', this.handleMouseUp);
        this.codeContent.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('selectionchange', this.handleSelectionChange);
    }

    private handleScroll() {
        const scrollTop = this.container.scrollTop;
        if (!this.isRenderPending) {
            requestAnimationFrame(() => {
                if (scrollTop !== this.lastScrollTop) {
                    this.render();
                    this.lastScrollTop = scrollTop;
                }
                this.isRenderPending = false;
            });
            this.isRenderPending = true;
        }
    }

    private createSpacer(height: number): HTMLDivElement {
        const spacer = document.createElement('div');
        spacer.className = "spacer";
        spacer.style.height = `${height}px`;
        return spacer;
    }

    private createLineNumber(lineNumber: number): HTMLDivElement {
        const div = document.createElement('div');
        div.className = "ln";
        div.textContent = (lineNumber + 1).toString();
        div.style.height = `${this.settings.lineHeight}px`;
        div.setAttribute('data-line', lineNumber.toString());
        return div;
    }

    private createButtonsColumnLine(lineNumber: number): HTMLDivElement {
        const div = document.createElement('div');
        div.style.height = `${this.settings.lineHeight}px`;
        div.setAttribute('data-line', lineNumber.toString());
    
        const isRun = this.runLines.includes(lineNumber);
        const hasError = this.errorLines.has(lineNumber);
    
        if (isRun) {
            div.textContent = '▶';
            div.title = `Run line ${lineNumber + 1}`;
            div.style.color = '#888';
            div.style.fontSize = '20px';
            div.style.cursor = 'pointer';
            div.onclick = () => {
                console.log(`Run line ${lineNumber + 1}`);
            };
        } else if (hasError) {
            const errorText = this.errorLines.get(lineNumber)!;
            div.textContent = '!';
            div.title = errorText;
            div.style.color = '#ff6b6b';
            div.style.cursor = 'pointer';
            div.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                navigator.clipboard.writeText(errorText).then(() => {
                    console.log(`Copied error: ${errorText}`);
                }).catch(err => {
                    console.error('Failed to copy:', err);
                });
            };
        }
    
        return div;
    }

    private createLineWrapper(
        lineNumber: number, nodes: HighlighedNode[]
    ): AnycodeLine {
        const wrapper = document.createElement('div') as AnycodeLine;
        
        wrapper.lineNumber = lineNumber;
        wrapper.className = "line";
        wrapper.style.lineHeight = `${this.settings.lineHeight}px`;

        // Add hash for change tracking
        const hash = objectHash(nodes).toString();
        wrapper.setAttribute('data-hash', hash);

        if (nodes.length === 0 || (nodes.length === 1 && nodes[0].text === "")) {
            const span = document.createElement('span');
            span.textContent = "";
            wrapper.appendChild(span);
        } else {
            for (const { name, text } of nodes) {
                const span = document.createElement('span');
                if (name) span.className = name;
                if (!name && text === '\t') span.className = 'indent';
                span.textContent = text;
                wrapper.appendChild(span);
            }
        }

        const errorMessage = this.errorLines.get(lineNumber);
        if (errorMessage) {
            let smallError = minimize(errorMessage);
            wrapper.classList.add('has-error');
            wrapper.setAttribute('data-error', smallError);
        }

        return wrapper;
    }
    
    private getVisibleRange() {
        const totalLines = this.code.linesLength();
        const scrollTop = this.container.scrollTop;
        const viewHeight = this.container.clientHeight;
        
        let visibleBuffer = this.settings.buffer;
        let itemHeight = this.settings.lineHeight;
        const visibleCount = Math.ceil(viewHeight / itemHeight);
        const startLine = Math.max(0, Math.floor(scrollTop / itemHeight) - visibleBuffer);
        const endLine = Math.min(totalLines, startLine + visibleCount + visibleBuffer * 2);
    
        return { startLine, endLine };
    }

    public render() {
        const totalLines = this.code.linesLength();
        const { startLine, endLine } = this.getVisibleRange();
        
        let itemHeight = this.settings.lineHeight;
        const paddingTop = startLine * itemHeight;
        const paddingBottom = (totalLines - endLine) * itemHeight;

        const buttonFragment = document.createDocumentFragment();
        buttonFragment.appendChild(this.createSpacer(paddingTop));
        for (let i = startLine; i < endLine; i++) {
            buttonFragment.appendChild(this.createButtonsColumnLine(i));
        }
        buttonFragment.appendChild(this.createSpacer(paddingBottom));
        this.buttonsColumn.replaceChildren(buttonFragment);

        const gutterFragment = document.createDocumentFragment();
        gutterFragment.appendChild(this.createSpacer(paddingTop));
        for (let i = startLine; i < endLine; i++) {
            gutterFragment.appendChild(this.createLineNumber(i));
        }
        gutterFragment.appendChild(this.createSpacer(paddingBottom));
        this.gutter.replaceChildren(gutterFragment);

        const codeFragment = document.createDocumentFragment();
        codeFragment.appendChild(this.createSpacer(paddingTop));
        for (let i = startLine; i < endLine; i++) {
            const nodes = this.code.getLineNodes(i);
            const lineWrapper = this.createLineWrapper(i, nodes);
            codeFragment.appendChild(lineWrapper);
        }
        codeFragment.appendChild(this.createSpacer(paddingBottom));
        this.codeContent.replaceChildren(codeFragment);

        const fullHeight = this.codeContent.scrollHeight;
        this.gutter.style.height = `${fullHeight}px`;
        this.buttonsColumn.style.height = `${fullHeight}px`;
        this.codeContent.style.height = `${fullHeight}px`;
                
        if (!this.selection || this.selection.isEmpty()) {
            this.updateCursor(false);
        } else {
            this.ignoreNextSelectionSet = true;
            renderSelection(this.selection, this.getLines(), this.code)
        }
    }
    
    private getLines(): AnycodeLine[] {
        const lines = Array.from(this.codeContent.children)
            .filter(child => 
                !child.classList.contains('spacer')
            ) as AnycodeLine[];
        return lines;
    }
    
    private getLine(lineNumber: number): AnycodeLine | null {
        const { startLine, endLine } = this.getVisibleRange();
        if (lineNumber < startLine || lineNumber >= endLine) return null;
    
        const relativeLine = lineNumber - startLine + 1; // +1 for the spacer
        const line = this.codeContent.children[relativeLine];
        return line as AnycodeLine;
    }
    
    private updateCursor(focus: boolean = true) {
        const { line, column } = this.code.getPosition(this.offset);
        const lineDiv = this.getLine(line);
    
        if (lineDiv && lineDiv.isConnected) {
            moveCursor(lineDiv, column, focus);
        } else {
            removeCursor();
        }
    }
    
    public renderChanges() {
        console.time('updateChanges');

        let { startLine, endLine } = this.getVisibleRange();
        
        const codeChildren = Array.from(this.codeContent.children).filter(child => 
            !child.classList.contains('spacer')
        ) as AnycodeLine[];
        
        if (codeChildren.length === 0) { this.render(); return; }
    
            
        let oldStartLine = codeChildren[0].lineNumber;
        let oldEndLine = codeChildren[codeChildren.length - 1].lineNumber + 1;

        if (oldStartLine !== startLine || oldEndLine !== endLine) {
            // console.log('oldStartLine !== startLine || oldEndLine !== endLine full render');
            this.render();
            console.timeEnd('updateChanges');
            return;
        }
        
        // Update or add visible lines
        for (let i = startLine; i < endLine; i++) {
            const nodes = this.code.getLineNodes(i);
            const theHash = objectHash(nodes).toString();

            // Find existing line element
            const existingLine = codeChildren.find(line => line.lineNumber === i);

            if (existingLine) {
                const existingHash = existingLine.getAttribute('data-hash');
                if (existingHash !== theHash) {
                    // Replace line
                    // console.log(`Line ${i} update`);
                    // Try smarter approach to update row 
                    const newLineElement = this.createLineWrapper(i, nodes);
                    existingLine.replaceWith(newLineElement);
                    
                }
            } else {
                // This should trigger a full re-render since we're missing lines
                // console.log('Missing lines detected, triggering full render');
                this.render();
                console.timeEnd('updateChanges');
                return;
            }
        }
        
        console.timeEnd('updateChanges');
    }
    
    private handleClick(e: MouseEvent): void {
        // console.log("handleClick ", this.selection);
        if (this.selection && this.selection.nonEmpty()) {
            return;
        }
        
        e.preventDefault();
        
        const pos = getPosFromMouse(e);
        if (!pos) return;
    
        const o = this.code.getOffset(pos.row, pos.col);
        this.offset = o;
        
        // console.log('click pos ', pos, o);
        this.ignoreNextSelectionSet = true;
        this.updateCursor();
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
            this.ignoreNextSelectionSet = true;
            renderSelection(this.selection, this.getLines(), this.code)
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
                this.offset = currentOffset;
            }
        
            this.ignoreNextSelectionSet = true;
            renderSelection(this.selection, this.getLines(), this.code);
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
        this.ignoreNextSelectionSet = true;
        renderSelection(this.selection, this.getLines(), this.code)
    }
    
    private selectLine(row: number) {
        const line = this.code.line(row);
        const start = this.code.getOffset(row, 0);
        const end   = this.code.getOffset(row, line.length);
    
        this.selection = new Selection(start, end);
    
        this.offset = end;
        this.ignoreNextSelectionSet = true;
        renderSelection(this.selection, this.getLines(), this.code)
    }
    
    private handleSelectionChange(e: Event) {
        if (this.ignoreNextSelectionSet) {
            this.ignoreNextSelectionSet = false;
            return;
        }
        
        const selection = getSelection();
        if (selection) {
            const start = this.code.getOffset(selection.start.row, selection.start.col);
            const end = this.code.getOffset(selection.end.row, selection.end.col);
            this.selection = new Selection(start, end);
        }
    }
    
    private async handleKeydown(event: KeyboardEvent) {
        // console.log('keydown', event);
        if (event.ctrlKey && event.key === " ") {
            event.preventDefault();
            this.toggleCompletion();
            return;
        }
    
        if (this.handleCompletionKey(event)) {
            event.preventDefault();
            return;
        }
        
        const action = this.getActionFromKey(event);
        if (!action) return;
        
        event.preventDefault();
        
        const ctx: ActionContext = {
            offset: this.offset,
            code: this.code,
            selection: this.selection || undefined,
            event: event
        };
        
        const result = await executeAction(action, ctx);
        this.applyEditResult(result);
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
        }
        
        // Text input
        if (key.length === 1 && !ctrlKey) {
            return Action.TEXT_INPUT;
        }
        
        return null;
    }
    
    private applyEditResult(result: ActionResult) {
        if (result.changed) {
            this.code = result.ctx.code;
            this.renderChanges();
        }
        if (result.ctx.offset !== this.offset) {
            this.offset = result.ctx.offset;
            this.updateCursor(true);
        }
        if (this.selection !== result.ctx.selection) {
            this.selection = result.ctx.selection || null;
            if (this.selection) {
                this.ignoreNextSelectionSet = true;
                renderSelection(this.selection, this.getLines(), this.code)
            }
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
    
    private async toggleCompletion() {
        if (this.completionContainer) {
            this.closeCompletionBox();
            return;
        }
        
        if (!this.completions.length) return;
        
        this.completionContainer = document.createElement('div');
        this.completionContainer.className = 'completion-box';
            
        const completions = this.completions;
        this.selectedCompletionIndex = 0;
        
        for (let i = 0; i < completions.length; i++) {
            const item = completions[i];
            const div = document.createElement('div');
            div.className = 'completion-item';
            div.textContent = item;
            div.dataset.index = i.toString();
            div.onmouseenter = () => this.highlightCompletion(i);
            div.onclick = () => this.selectCompletion(i);
            this.completionContainer!.appendChild(div);
        }
        this.highlightCompletion(0);
    
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        
        // move completion under cursor position
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        const containerRect = this.container.getBoundingClientRect();
        const top = rect.bottom - containerRect.top + this.container.scrollTop;
        const left = rect.left - containerRect.left + this.container.scrollLeft;
        
        this.completionContainer!.style.position = 'absolute';
        this.completionContainer!.style.top = `${top}px`;
        this.completionContainer!.style.left = `${left}px`;
    
        this.container.appendChild(this.completionContainer!);
    }
    
    private highlightCompletion(index: number) {
        if (!this.completionContainer) return;
        const children = this.completionContainer.children;
        for (let i = 0; i < children.length; i++) {
            const el = children[i] as HTMLElement;
            el.style.background = i === index ? '#333' : 'transparent';
            if (i === index) el.scrollIntoView({ block: 'nearest' });
        }
        this.selectedCompletionIndex = index;
    }

    
    private selectCompletion(index: number) {
        const value = this.completions[index];
        // todo insert completion logic here
        this.closeCompletionBox();
    }
    
    private closeCompletionBox() {
        this.completionContainer?.remove();
        this.completionContainer = null;
    }
    
    private handleCompletionKey(event: KeyboardEvent): boolean {
        if (!this.completionContainer) return false;
    
        if (event.key === "ArrowDown") {
            const next = (this.selectedCompletionIndex + 1) 
                % this.completions.length;
            this.highlightCompletion(next);
            return true;
        }
    
        if (event.key === "ArrowUp") {
            const prev = (this.selectedCompletionIndex - 1 + this.completions.length) 
                % this.completions.length;
            this.highlightCompletion(prev);
            return true;
        }
    
        if (event.key === "Enter") {
            this.selectCompletion(this.selectedCompletionIndex);
            return true;
        }
    
        if (event.key === "Escape") {
            this.closeCompletionBox();
            return true;
        }
    
        return false;
    }
}
