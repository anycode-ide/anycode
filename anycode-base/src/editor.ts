import { Code, Edit, HighlighedNode } from "./code";
import { 
    generateCssClasses, addCssToDocument, isCharacter,
    AnycodeLine as AnycodeLine, Pos,
    minimize, objectHash,
    findPrevWord, findNextWord, getCompletionRange,
    findNodeAndOffset, scoreMatches
} from './utils';

import { vesper } from './theme';
import {
    Action, ActionContext, ActionResult, executeAction,
    removeSelection, smartPaste
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
import { Completion, completionKindMap, CompletionRequest } from "./lsp";


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
    private maxLineWidth = 0;
    
    private isMouseSelecting: boolean = false;
    private selection: Selection | null = null;
    private autoScrollTimer: number | null = null;
    private isWordSelection: boolean = false;
    private wordSelectionAnchor: number = 0;
    
    private lastScrollTop = 0;

    private runLines: number[] = [];
    private errorLines: Map<number, string> = new Map();
    
    private completionContainer: HTMLDivElement | null = null;
    private selectedCompletionIndex = 0;
    private completions: Completion[] = [];
    private completionProvider: ((request: CompletionRequest) => Promise<Completion[]>) | null = null;

    constructor(initialText = '', filename: string = 'test.txt', options: any = {}) {
        this.offset = 0;
        const language = options.language || "javascript";
        this.code = new Code(initialText, filename, language);
        this.settings = { lineHeight: 20, buffer: 30 };
        
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

    public clean() {
        console.log('clean');
        this.removeEventListeners();
        this.offset = 0;
        this.selection = null;
        
        if (this.container && this.container.parentElement) {
            this.container.parentElement.removeChild(this.container);
        }
    }

    public setOnEdit(onEdit: (e: Edit) => void ) {
        this.code.setOnEdit(onEdit);
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

    public setRunButtonLines(lines: number[]) {
        this.runLines = lines;
    }

    public setErrors(errors: { line: number, message: string }[]) {
        this.errorLines.clear();
        for (const { line, message } of errors) {
            this.errorLines.set(line, message);
        }
        this.renderErrors();
    }
    
    public setCompletions(completions: Completion[]) {
        this.completions = completions;
    }

    public setCompletionProvider(
        completionProvider: (request: CompletionRequest) => Promise<Completion[]>
    ) {
        this.completionProvider = completionProvider;
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
                this.renderScroll();
                this.lastScrollTop = scrollTop;
            }
        });
    }

    public hasScroll() {
        return this.lastScrollTop !== 0;
    }

    public restoreScroll() {
        this.container.scrollTop = this.lastScrollTop;
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

    private createLineButtons(lineNumber: number): HTMLDivElement {
        const div = document.createElement('div');
        div.className = "bt";
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
        }
        // else if (hasError) {
        //     const errorText = this.errorLines.get(lineNumber)!;
        //     div.textContent = '!';
        //     div.title = errorText;
        //     div.style.color = '#ff6b6b';
        //     div.style.cursor = 'pointer';
        //     div.onclick = (e) => {
        //         e.preventDefault();
        //         e.stopPropagation();
        //         navigator.clipboard.writeText(errorText).then(() => {
        //             console.log(`Copied error: ${errorText}`);
        //         }).catch(err => {
        //             console.error('Failed to copy:', err);
        //         });
        //     };
        // }
    
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
        
        // Fallback for the case when the container doesn't have sizes (first render)
        let visibleCount: number;
        if (viewHeight > 0) {
            visibleCount = Math.ceil(viewHeight / itemHeight);
        } else {
            // Try to get sizes from parent element or use screen sizes
            const parentHeight = this.container.parentElement?.clientHeight || 0;
            const fallbackHeight = parentHeight > 0 ? parentHeight : window.innerHeight;
            visibleCount = Math.min(Math.floor(fallbackHeight / itemHeight), totalLines);
        }
        
        const startLine = Math.max(0, Math.floor(scrollTop / itemHeight) - visibleBuffer);
        const endLine = Math.min(totalLines, startLine + visibleCount + visibleBuffer * 2);
    
        return { startLine, endLine };
    }

    public render() {
        console.log('render');
        const totalLines = this.code.linesLength();
        const { startLine, endLine } = this.getVisibleRange();
        
        let itemHeight = this.settings.lineHeight;
        const paddingTop = startLine * itemHeight;
        const paddingBottom = (totalLines - endLine) * itemHeight;

        const buttonFragment = document.createDocumentFragment();
        buttonFragment.appendChild(this.createSpacer(paddingTop));
        for (let i = startLine; i < endLine; i++) {
            buttonFragment.appendChild(this.createLineButtons(i));
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

        const maxLineWidth = this.codeContent.scrollWidth;
        if (maxLineWidth > this.maxLineWidth) {
            this.maxLineWidth = maxLineWidth;
            this.codeContent.style.minWidth = `${this.maxLineWidth}px`;
        }
        
        this.renderCursorOrSelection(false);
    }

    private ensureSpacers(container: HTMLElement) {
        if (container.children.length < 2) {
            const top = this.createSpacer(0);
            const bottom = this.createSpacer(0);
            container.appendChild(top);
            container.appendChild(bottom);
        }
    }

    public renderScroll() {
        const totalLines = this.code.linesLength();
        const lineHeight = this.settings.lineHeight;
    
        const buffer = this.settings.buffer;
        const { startLine, endLine } = this.getVisibleRange();
    
        const code = this.code;
    
        this.ensureSpacers(this.codeContent);
        this.ensureSpacers(this.gutter);
        this.ensureSpacers(this.buttonsColumn);
    
        const topSpacer = this.codeContent.firstChild as HTMLElement;
        const bottomSpacer = this.codeContent.lastChild as HTMLElement;
    
        const gutterTopSpacer = this.gutter.firstChild as HTMLElement;
        const gutterBottomSpacer = this.gutter.lastChild as HTMLElement;
    
        const btnTopSpacer = this.buttonsColumn.firstChild as HTMLElement;
        const btnBottomSpacer = this.buttonsColumn.lastChild as HTMLElement;
    
        let currentStartLine = (this.codeContent.children[1] as AnycodeLine)?.lineNumber ?? -1;
        let currentEndLine =
            ((this.codeContent.children[this.codeContent.children.length - 2] as AnycodeLine)
                ?.lineNumber ?? -1) + 1; // exclusive
    
        let changed = false;
    
        // --- full rerender if needed ---
        const needFullRerender =
            currentStartLine === -1 ||
            startLine >= currentEndLine || endLine <= currentStartLine ||
            Math.abs(startLine - currentStartLine) > buffer * 2 ||
            Math.abs(endLine - currentEndLine) > buffer * 2;
    
        if (needFullRerender) {
            this.render();
            return;
        }
    
        // --- delete above ---
        while (currentStartLine < startLine && this.codeContent.children.length > 2) {
            this.codeContent.removeChild(this.codeContent.children[1]);
            this.gutter.removeChild(this.gutter.children[1]);
            this.buttonsColumn.removeChild(this.buttonsColumn.children[1]);
            currentStartLine++;
            changed = true;
        }
    
        // --- delete below ---
        while (currentEndLine > endLine && this.codeContent.children.length > 2) {
            this.codeContent.removeChild(this.codeContent.children[this.codeContent.children.length - 2]);
            this.gutter.removeChild(this.gutter.children[this.gutter.children.length - 2]);
            this.buttonsColumn.removeChild(this.buttonsColumn.children[this.buttonsColumn.children.length - 2]);
            currentEndLine--;
            changed = true;
        }
    
        // --- dynamically calculate maxLineWidth for stable vertical scroll ---
        let maxLineWidth = this.maxLineWidth || 0;
    
        // --- add above ---
        while (currentStartLine > startLine) {
            currentStartLine--;
            const nodes = code.getLineNodes(currentStartLine);
            const lineEl = this.createLineWrapper(currentStartLine, nodes);
    
            // measure line width
            this.container.appendChild(lineEl);
            // const width = lineEl.scrollWidth;
            this.container.removeChild(lineEl);
            // if (width > maxLineWidth) maxLineWidth = width;
    
            this.codeContent.insertBefore(lineEl, this.codeContent.children[1]);
            this.gutter.insertBefore(this.createLineNumber(currentStartLine), this.gutter.children[1]);
            this.buttonsColumn.insertBefore(this.createLineButtons(currentStartLine), this.buttonsColumn.children[1]);
    
            changed = true;
        }
    
        // --- add below ---
        while (currentEndLine < endLine) {
            const nodes = code.getLineNodes(currentEndLine);
            const lineEl = this.createLineWrapper(currentEndLine, nodes);
    
            // measure line width
            this.container.appendChild(lineEl);
            // const width = lineEl.scrollWidth;
            this.container.removeChild(lineEl);
            // if (width > maxLineWidth) maxLineWidth = width;
    
            this.codeContent.insertBefore(lineEl, bottomSpacer);
            this.gutter.insertBefore(this.createLineNumber(currentEndLine), gutterBottomSpacer);
            this.buttonsColumn.insertBefore(this.createLineButtons(currentEndLine), btnBottomSpacer);
    
            currentEndLine++;
            changed = true;
        }
    
        // update global max line width
        // this.maxLineWidth = maxLineWidth;
        // this.codeContent.style.minWidth = `${this.maxLineWidth}px`;
    
        if (!changed) return;
    
        // --- update spacers with rounding ---
        const topHeight = Math.round(startLine * lineHeight);
        const bottomHeight = Math.round(Math.max(0, (totalLines - endLine) * lineHeight));
    
        topSpacer.style.height = `${topHeight}px`;
        bottomSpacer.style.height = `${bottomHeight}px`;
    
        gutterTopSpacer.style.height = `${topHeight}px`;
        gutterBottomSpacer.style.height = `${bottomHeight}px`;
    
        btnTopSpacer.style.height = `${topHeight}px`;
        btnBottomSpacer.style.height = `${bottomHeight}px`;
    
        // const visibleCount = endLine - startLine;
        // const totalHeight = topHeight + visibleCount * lineHeight + bottomHeight;
        // const expectedHeight = totalLines * lineHeight;
        // const containerScrollHeight = this.container.scrollHeight;
        // const containerClientHeight = this.container.clientHeight;
    
        // console.log("[SCROLL DEBUG]", {
        //     startLine,
        //     endLine,
        //     visibleCount,
        //     topHeight,
        //     bottomHeight,
        //     totalHeight,
        //     expectedHeight,
        //     containerScrollHeight,
        //     containerClientHeight,
        //     maxLineWidth,
        //     childrenCount: this.codeContent.children.length
        // });
    
        this.renderCursorOrSelection(false);
    }

    public renderCursorOrSelection(focus: boolean = false) {

        if (!this.selection || this.selection.isEmpty()) {
            this.updateCursor(focus);
        } else {
            let lines = this.getLines();
            let attached = true;
            for (const line of lines) {
                if (!line.isConnected) {
                    attached = false;
                    break;
                }
            }

            if (attached) {
                renderSelection(this.selection, lines, this.code)
            } else {
                requestAnimationFrame(() => renderSelection(this.selection!, lines, this.code));
            }
        }
    }
    
    private getLines(): AnycodeLine[] {
        const lines = Array.from(this.codeContent.children)
            .filter(child => !child.classList.contains('spacer')) as AnycodeLine[];
        return lines;
    }
    
    public getLine(lineNumber: number): AnycodeLine | null {
        if (this.codeContent.children.length <= 2) return null; // only spacers
        
        const firstLine = this.codeContent.children[1] as AnycodeLine;
        const firstLineNumber = firstLine.lineNumber;
        const idx = lineNumber - firstLineNumber;
    
        // check for out of bounds
        if (idx < 0 || idx >= this.codeContent.children.length - 2) {
            return null;
        }
    
        return this.codeContent.children[idx + 1] as AnycodeLine;
    }
    
    private updateCursor(focus: boolean = true) {
        const { line, column } = this.code.getPosition(this.offset);
        // console.log('updateCursor', { line, column, offset: this.offset });
        const lineDiv = this.getLine(line);
    
        if (lineDiv) {
            if (lineDiv.isConnected) {
                moveCursor(lineDiv, column, focus);
            } else {
                requestAnimationFrame(() => moveCursor(lineDiv, column, focus));
            }
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
                    const newLineElement = this.createLineWrapper(i, nodes);
                    existingLine.replaceWith(newLineElement);
                }
            } else {
                this.render();
                console.timeEnd('updateChanges');
                return;
            }
        }
        
        console.timeEnd('updateChanges');
    }

    private renderErrors() {
        console.time('renderErrors');  

        const lines = this.getLines();
        if (!lines.length) return;
            
        for (let i = 0; i < lines.length; i++) {
            const lineDiv = lines[i];
            const lineNumber = lineDiv.lineNumber;
        
            if (this.errorLines.has(lineNumber)) {
                const dm = this.errorLines.get(lineNumber)!;
                // Only update attribute if value is different or missing
                if (lineDiv.getAttribute('data-error') !== dm) {
                    lineDiv.setAttribute('data-error', dm);
                    lineDiv.classList.add('has-error');
                }
            } else {
                // Only remove attribute if it exists
                if (lineDiv.hasAttribute('data-error')) {
                    lineDiv.removeAttribute('data-error');
                    lineDiv.classList.remove('has-error');
                }
            }
        }
        console.timeEnd('renderErrors');
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
        this.updateCursor();

        if (this.isCompletionOpen()){
            this.closeCompletion();
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
        // console.log('Editor lost focus');
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
        // console.log('handleMouseMove', pos);

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
                this.offset = currentOffset;
            }
            
            if (oldSelection && !oldSelection.equals(this.selection)) {
                // console.log('selection changed');
                renderSelection(this.selection, this.getLines(), this.code);
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
        renderSelection(this.selection, this.getLines(), this.code)
    }
    
    private selectLine(row: number) {
        const lineLen = this.code.lineLength(row);
        const start = this.code.getOffset(row, 0);
        const end = this.code.getOffset(row, lineLen);
    
        this.selection = new Selection(start, end);
    
        this.offset = end;
        renderSelection(this.selection, this.getLines(), this.code)
    }
    
    private async handleKeydown(event: KeyboardEvent) {
        console.log('keydown', event);
        if (event.metaKey && event.key === " ") {
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
        
        // Special-case paste in non-secure context: let native paste flow,
        // which will be handled by the 'beforeinput' listener.
        if (action === Action.PASTE && !(navigator.clipboard && window.isSecureContext)) {
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

        if (this.isCompletionOpen()){
            await this.showCompletion();
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
        
        // Update all state first
        if (textChanged) {
            this.code = result.ctx.code;
        }
        
        if (offsetChanged) {
            this.offset = result.ctx.offset;
        }
        
        if (selectionChanged) {
            this.selection = result.ctx.selection || null;
        }
        
        // Then render based on what changed
        if (textChanged) {
            // Text changed - rerender changes
            this.maxLineWidth = 0
            this.renderChanges();
            this.renderCursorOrSelection(true);
        } else if (selectionChanged) {
            // Only selection changed - render selection
            if (this.selection) {
                renderSelection(this.selection, this.getLines(), this.code);
            } else {
                this.updateCursor(true);
            }
        } else if (offsetChanged) {
            // Only cursor changed - update cursor
            this.updateCursor(true);
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

        let insertOffset = this.offset;

        this.code.tx();
        this.code.setStateBefore(this.offset, this.selection || undefined);

        if (this.selection && this.selection.nonEmpty()) {
            const [start, end] = this.selection.sorted();
            this.code.remove(start, end - start);
            insertOffset = start;
            this.selection = null;
        }

        // Use smart paste for indentation awareness
        const toInsert = smartPaste(this.code, insertOffset, pastedText);
        this.code.insert(toInsert, insertOffset);
        
        this.offset = insertOffset + toInsert.length;

        this.code.setStateBefore(this.offset, this.selection || undefined);
        this.code.commit();

        this.maxLineWidth = 0;
        this.renderChanges();
        this.renderCursorOrSelection(true);
    }
    
    public async toggleCompletion() {
        console.log('anycode: toggle completion');

        if (this.isCompletionOpen()) {
            this.closeCompletion();
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
            this.closeCompletion();
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
        
        this.renderCompletion();
    }

    private renderCompletion() {
        if (!this.completionContainer) {
            this.completionContainer = document.createElement('div');
            this.completionContainer.className = 'completion-box glass';
            this.container!.appendChild(this.completionContainer);
            this.moveCompletion();
        }

        const completionCb = this.applyCompletion.bind(this);
        const fragment = document.createDocumentFragment();

        this.selectedCompletionIndex = 0;

        this.completions.forEach((completion, i) => {
            const completionDiv = document.createElement('div');
            completionDiv.className = 'completion-item';
            completionDiv.textContent = completion.label;

            if (completion.kind) {  
                const kindText = document.createElement('span');
                kindText.className = 'completion-kind';
                kindText.textContent = completionKindMap[completion.kind] || 'Unknown';
                completionDiv.appendChild(kindText);
            }

            completionDiv.addEventListener('click', e => {
                e.preventDefault();
                completionCb(i);
            });

            // completionDiv.addEventListener('mouseenter', () => {
            //     this.hoverCompletion(i);
            // });
            // completionDiv.addEventListener('mouseleave', () => {
            //     this.hoverCompletion(-1);
            // });

            if (i === 0) completionDiv.classList.add('completion-active');
            fragment.appendChild(completionDiv);
        });

        this.completionContainer.replaceChildren(fragment);
        this.moveCompletion();
    }

    private moveCompletion() {

        let { line, column } = this.code.getPosition(this.offset);

        let lineStr = this.code.line(line);
        let prev = findPrevWord(lineStr, column)

        var completion = this.completionContainer;

        const startLineDiv = this.getLine(line);
        const startPos = findNodeAndOffset(startLineDiv!, prev+1);

        if (startPos) {
            // move completion to previous word position around cursor
            const { node, offset } = startPos;

            const calculateBoundingRect = (textNode: any) => {
                const range = document.createRange();
                range.selectNode(textNode);
                return range.getBoundingClientRect();
            };

            const startRect = calculateBoundingRect(node);
            const paddingLeft = parseInt(getComputedStyle(completion!).paddingLeft || "10");
            const containerRect = this.container.getBoundingClientRect();
            const left = startRect.left - containerRect.left + this.container.scrollLeft - paddingLeft*2;
            const top = startRect.bottom - containerRect.top + this.container.scrollTop + 1;

            if (completion && completion.style) {
                completion.style.left = left + "px";
                completion.style.top = top + "px";
            }
        } else {
            // move completion under cursor position
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return;
            const range = sel.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            const containerRect = this.container.getBoundingClientRect();
            const top = rect.bottom - containerRect.top + this.container.scrollTop;
            const left = rect.left - containerRect.left + this.container.scrollLeft;
            this.completionContainer!.style.position = 'absolute';
            this.completionContainer!.style.top = `${top}px`;
            this.completionContainer!.style.left = `${left}px`;
        }
    }
    
    private highlightCompletion(index: number) {
        if (!this.completionContainer) return;
        const children = this.completionContainer.children;
        for (let i = 0; i < children.length; i++) {
            const el = children[i] as HTMLElement;
            el.classList.toggle('completion-active', i === index);
            if (i === index) el.scrollIntoView({ block: 'nearest' });
        }
        this.selectedCompletionIndex = index;
    }

    private hoverCompletion(index: number) {
        if (!this.completionContainer) return;
        const children = this.completionContainer.children;
        for (let i = 0; i < children.length; i++) {
            const el = children[i] as HTMLElement;
            el.classList.toggle('completion-hover', i === index);
        }
    }

    public applyCompletion(index: number) {
        if (index < 0 || index >= this.completions.length) return;
        if (!this.completionContainer) return;

        let { line, column } = this.code.getPosition(this.offset);
        let completionItem = this.completions[index];
        let text = completionItem.label;
        
        let lineStr = this.code.line(line);
        
        // Determine the range to replace using the helper function
        let { start: replaceStart, end: replaceEnd } = getCompletionRange(lineStr, column);

        // Start transaction and perform replacement
        this.code.tx();
        let startOffset = this.code.getOffset(line, replaceStart);
        let endOffset = this.code.getOffset(line, replaceEnd);
        this.code.remove(startOffset, endOffset - startOffset);
        this.code.insert(text, startOffset);
        this.code.commit();

        // Update cursor position to end of inserted text
        this.offset = startOffset + text.length;

        this.closeCompletion();
        this.renderChanges();
        this.updateCursor();
    }

    private closeCompletion() {
        this.completionContainer?.remove();
        this.completionContainer = null;
    }

    private isCompletionOpen() {
        return this.completionContainer !== null;
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
            this.applyCompletion(this.selectedCompletionIndex);
            return true;
        }
    
        if (event.key === "Escape") {
            this.closeCompletion();
            return true;
        }
    
        return false;
    }
}
