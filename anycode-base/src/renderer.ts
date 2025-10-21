import { Code, HighlighedNode } from "./code";
import { AnycodeLine, objectHash, minimize, findNodeAndOffset, findPrevWord } from "./utils";
import { moveCursor, removeCursor } from "./cursor";
import { EditorState, EditorSettings } from "./editor";
import {
    Selection, getSelection,
    setSelectionFromOffsets as renderSelection,
} from "./selection";
import { Completion, completionKindMap } from "./lsp";

export class Renderer {
    private container: HTMLDivElement;
    private buttonsColumn: HTMLDivElement;
    private gutter: HTMLDivElement;
    private codeContent: HTMLDivElement;
    private maxLineWidth = 0;
    private completionContainer: HTMLDivElement | null = null;

    constructor(
        container: HTMLDivElement,
        buttonsColumn: HTMLDivElement,
        gutter: HTMLDivElement,
        codeContent: HTMLDivElement
    ) {
        this.container = container;
        this.buttonsColumn = buttonsColumn;
        this.gutter = gutter;
        this.codeContent = codeContent;
    }

    public render(state: EditorState) {
        console.log("render");
        const { code, offset, selection, runLines, errorLines, settings } = state;

        const totalLines = code.linesLength();
        const { startLine, endLine } = this.getVisibleRange(totalLines, settings);
        let itemHeight = settings.lineHeight;
        const paddingTop = startLine * itemHeight;
        const paddingBottom = (totalLines - endLine) * itemHeight;

        // build fragments for better performance
        const btnFrag = document.createDocumentFragment();
        const gutterFrag = document.createDocumentFragment();
        const codeFrag = document.createDocumentFragment();

        // top spacers
        btnFrag.appendChild(this.createSpacer(paddingTop));
        gutterFrag.appendChild(this.createSpacer(paddingTop));
        codeFrag.appendChild(this.createSpacer(paddingTop));

        for (let i = startLine; i < endLine; i++) {
            // get syntax highlight nodes (cache supported)
            const syntaxNodes: HighlighedNode[] = code.getLineNodes(i);

            const lineWrapper = this.createLineWrapper(i, syntaxNodes, errorLines, settings);
            const lineNumberEl = this.createLineNumber(i, settings);
            const lineButtonEl = this.createLineButtons(i, runLines, errorLines, settings);

            codeFrag.appendChild(lineWrapper);
            gutterFrag.appendChild(lineNumberEl);
            btnFrag.appendChild(lineButtonEl);
        }

         // bottom spacers
        btnFrag.appendChild(this.createSpacer(paddingBottom));
        gutterFrag.appendChild(this.createSpacer(paddingBottom));
        codeFrag.appendChild(this.createSpacer(paddingBottom));

        // replace old children atomically
        this.buttonsColumn.replaceChildren(btnFrag);
        this.gutter.replaceChildren(gutterFrag);
        this.codeContent.replaceChildren(codeFrag);

        // render cursor or selection
        if (!selection || selection.isEmpty()) {
            const { line, column } = code.getPosition(offset);
            this.renderCursor(line, column, false);
        } else {
            this.renderSelection(code, selection!);
        }
    }

    public renderScroll(state: EditorState) {
        console.log("renderScroll");
        const { code, offset, selection, settings } = state;
        const totalLines = code.linesLength();
        const lineHeight = settings.lineHeight;
        const buffer = settings.buffer;
        const { startLine, endLine } = this.getVisibleRange(totalLines, settings);
    
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
        let currentEndLine = ((this.codeContent.children[this.codeContent.children.length - 2] as AnycodeLine)?.lineNumber ?? -1) + 1; // exclusive
    
        let changed = false;
    
        // --- full rerender if needed ---
        const needFullRerender =
            currentStartLine === -1 ||
            startLine >= currentEndLine ||
            endLine <= currentStartLine ||
            Math.abs(startLine - currentStartLine) > buffer * 2 ||
            Math.abs(endLine - currentEndLine) > buffer * 2;
    
        if (needFullRerender) {
            this.render(state);
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
            const lineEl = this.createLineWrapper(currentStartLine, nodes, state.errorLines, settings);
    
            this.container.appendChild(lineEl);
            this.container.removeChild(lineEl);
    
            this.codeContent.insertBefore(lineEl, this.codeContent.children[1]);
            this.gutter.insertBefore(this.createLineNumber(currentStartLine, settings), this.gutter.children[1]);
            this.buttonsColumn.insertBefore(
                this.createLineButtons(currentStartLine, state.runLines, state.errorLines, settings),
                this.buttonsColumn.children[1]
            );
    
            changed = true;
        }
    
        // --- add below ---
        while (currentEndLine < endLine) {
            const nodes = code.getLineNodes(currentEndLine);
            const lineEl = this.createLineWrapper(currentEndLine, nodes, state.errorLines, settings);
    
            this.container.appendChild(lineEl);
            this.container.removeChild(lineEl);
    
            this.codeContent.insertBefore(lineEl, bottomSpacer);
            this.gutter.insertBefore(this.createLineNumber(currentEndLine, settings), gutterBottomSpacer);
            this.buttonsColumn.insertBefore(
                this.createLineButtons(currentEndLine, state.runLines, state.errorLines, settings),
                btnBottomSpacer
            );
    
            currentEndLine++;
            changed = true;
        }
    
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
    
        // render cursor or selection
        if (!selection || selection.isEmpty()) {
            const { line, column } = code.getPosition(offset);
            this.renderCursor(line, column, false);
        } else {
            this.renderSelection(code, selection!);
        }
    }

    public renderChanges(state: EditorState) {
        console.log("renderChanges");
        console.time('updateChanges');
    
        const { code, offset, selection, errorLines, settings } = state;
        const totalLines = code.linesLength();
        const { startLine, endLine } = this.getVisibleRange(totalLines, settings);
    
        const renderedLines = this.getLines(); // non-spacer lines
    
        if (renderedLines.length === 0) { 
            this.render(state); 
            console.timeEnd('updateChanges');
            return; 
        }
    
        const oldStartLine = renderedLines[0].lineNumber;
        const oldEndLine = renderedLines[renderedLines.length - 1].lineNumber + 1;
    
        if (oldStartLine !== startLine || oldEndLine !== endLine) {
            // Full render if viewport changed
            this.render(state);
            console.timeEnd('updateChanges');
            return;
        }
        
        // Update only changed lines
        for (let i = startLine; i < endLine; i++) {
            const nodes = code.getLineNodes(i);
            const newHash = objectHash(nodes).toString();
    
            const existingLine = renderedLines.find(line => line.lineNumber === i);
    
            if (existingLine) {
                const existingHash = existingLine.hash;
                if (existingHash !== newHash) {
                    const newLineEl = this.createLineWrapper(i, nodes, errorLines, settings);
                    existingLine.replaceWith(newLineEl);
                }
            } else {
                // Fallback to full render if line is missing
                this.render(state);
                console.timeEnd('updateChanges');
                return;
            }
        }

        // render cursor or selection
        if (!selection || selection.isEmpty()) {
            const { line, column } = code.getPosition(offset);
            this.renderCursor(line, column, true);
        } else {
            this.renderSelection(code, selection!);
        }
    
        console.timeEnd('updateChanges');
    }

    private ensureSpacers(container: HTMLElement) {
        const first = container.firstChild as HTMLElement | null;
        const last = container.lastChild as HTMLElement | null;
    
        if (!first || !first.classList?.contains('spacer')) {
            container.insertBefore(this.createSpacer(0), container.firstChild);
        }
    
        if (!last || !last.classList?.contains('spacer')) {
            container.appendChild(this.createSpacer(0));
        }
    }

    private createSpacer(height: number): HTMLDivElement {
        const spacer = document.createElement('div');
        spacer.className = "spacer";
        spacer.style.height = `${height}px`;
        return spacer;
    }

    private createLineNumber(lineNumber: number, settings: EditorSettings): HTMLDivElement {
        const div = document.createElement('div');
        div.className = "ln";
        div.textContent = (lineNumber + 1).toString();
        div.style.height = `${settings.lineHeight}px`;
        div.setAttribute('data-line', lineNumber.toString());
        return div;
    }

    private createLineButtons(
        lineNumber: number,
        runLines: number[],
        errorLines: Map<number, string>,
        settings: EditorSettings
    ): HTMLDivElement {
        const div = document.createElement('div');
        div.className = "bt";
        div.style.height = `${settings.lineHeight}px`;
        div.setAttribute('data-line', lineNumber.toString());

        const isRun = runLines.includes(lineNumber);
        // const hasError = errorLines.has(lineNumber); // если нужно в будущем

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

        return div;
    }

    private createLineWrapper(
        lineNumber: number,
        nodes: HighlighedNode[],
        errorLines: Map<number, string>,
        settings: EditorSettings
    ): AnycodeLine {
        const wrapper = document.createElement('div') as AnycodeLine;

        wrapper.lineNumber = lineNumber;
        wrapper.className = "line";
        wrapper.style.lineHeight = `${settings.lineHeight}px`;

        // Add hash for change tracking
        const hash = objectHash(nodes).toString();
        wrapper.hash = hash;

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

        const errorMessage = errorLines.get(lineNumber);
        if (errorMessage) {
            let smallError = minimize(errorMessage);
            wrapper.classList.add('has-error');
            wrapper.setAttribute('data-error', smallError);
        }

        return wrapper;
    }

    private getVisibleRange(totalLines: number, settings: EditorSettings) {
        const scrollTop = this.container.scrollTop;
        const viewHeight = this.container.clientHeight;

        let visibleBuffer = settings.buffer;
        let itemHeight = settings.lineHeight;

        // Fallback for cases when container doesn't have sizes (first render)
        let visibleCount: number;
        if (viewHeight > 0) {
            visibleCount = Math.ceil(viewHeight / itemHeight);
        } else {
            const parentHeight = this.container.parentElement?.clientHeight || 0;
            const fallbackHeight = parentHeight > 0 ? parentHeight : window.innerHeight;
            visibleCount = Math.min(Math.floor(fallbackHeight / itemHeight), totalLines);
        }

        const startLine = Math.max(0, Math.floor(scrollTop / itemHeight) - visibleBuffer);
        const endLine = Math.min(totalLines, startLine + visibleCount + visibleBuffer * 2);

        return { startLine, endLine };
    }

    public renderCursorOrSelection(state: EditorState, focus: boolean = false) {
        const { code, offset, selection } = state;
        if (!selection || selection.isEmpty()) {
            const { line, column } = code.getPosition(offset);
            this.renderCursor(line, column, focus);
        } else {
            this.renderSelection(code, selection!);
        }
    }

    public renderCursor(line: number, column: number, focus: boolean = false) {
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

    public renderSelection(code: Code, selection: Selection) {
        const lines = this.getLines();
        let attached = true;
        for (const l of lines) {
            if (!l.isConnected) { attached = false; break; }
        }
        if (attached) {
            renderSelection(selection, lines, code);
        } else {
            requestAnimationFrame(() => {
                renderSelection(selection, this.getLines(), code);
            });
        }
    }

    public getLines(): AnycodeLine[] {
        return Array.from(this.codeContent.children)
            .filter((child) => !child.classList.contains('spacer')) as AnycodeLine[];
    }

    public getLine(lineNumber: number): AnycodeLine | null {
        if (this.codeContent.children.length <= 2) return null; // only spacers
        const firstLine = this.codeContent.children[1] as AnycodeLine;
        const firstLineNumber = firstLine.lineNumber;
        const idx = lineNumber - firstLineNumber;
        if (idx < 0 || idx >= this.codeContent.children.length - 2) return null;
        return this.codeContent.children[idx + 1] as AnycodeLine;
    }

    public focus(state: EditorState): boolean {
        const { code, offset, settings } = state;
        if (!code) return false;
    
        const { line } = code.getPosition(offset);
    
        const cursorTop = line * settings.lineHeight;
        const cursorBottom = cursorTop + settings.lineHeight;
    
        const viewportTop = this.container.scrollTop;
        const viewportBottom = viewportTop + this.container.clientHeight;
    
        let targetScrollTop = viewportTop;
    
        if (cursorTop < viewportTop) {
            targetScrollTop = cursorTop;
        } else if (cursorBottom > viewportBottom) {
            targetScrollTop = cursorBottom - this.container.clientHeight;
        }
    
        if (targetScrollTop !== viewportTop) {
            this.container.scrollTo({ top: targetScrollTop });
            return true;
        }

        return false;
    }

    public focusCenter(state: EditorState): boolean {
        const { code, offset, settings } = state;
        if (!code) return false;
    
        const { line } = code.getPosition(offset);
    
        const cursorTop = line * settings.lineHeight;
        const cursorCenter = cursorTop + settings.lineHeight / 2;
    
        const viewportHeight = this.container.clientHeight;
        const targetScrollTop = cursorCenter - viewportHeight / 2;
    
        const maxScroll = this.container.scrollHeight - viewportHeight;
        const clampedScrollTop = Math.max(0, Math.min(targetScrollTop, maxScroll));
    
        this.container.scrollTo({ top: clampedScrollTop });
    
        return true;
    }

    public renderErrors(errorLines: Map<number, string>) {
        console.time('renderErrors');  

        const lines = this.getLines();
        if (!lines.length) return;
            
        for (let i = 0; i < lines.length; i++) {
            const lineDiv = lines[i];
            const lineNumber = lineDiv.lineNumber;
        
            if (errorLines.has(lineNumber)) {
                const dm = errorLines.get(lineNumber)!;
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

    public renderCompletion(
        completions: Completion[], selectedIndex: number, code: Code, offset: number, 
        onCompletionClick: (index: number) => void
    ) {
        if (!this.completionContainer) {
            this.completionContainer = document.createElement('div');
            this.completionContainer.className = 'completion-box glass';
            this.container!.appendChild(this.completionContainer);
            this.moveCompletion(code, offset);
        }

        const fragment = document.createDocumentFragment();

        completions.forEach((completion, i) => {
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
                onCompletionClick(i);
            });

            if (i === selectedIndex) completionDiv.classList.add('completion-active');
            fragment.appendChild(completionDiv);
        });

        this.completionContainer.replaceChildren(fragment);
        this.moveCompletion(code, offset);
    }

    public moveCompletion(code: Code, offset: number) {
        let { line, column } = code.getPosition(offset);

        let lineStr = code.line(line);
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

    public closeCompletion() {
        this.completionContainer?.remove();
        this.completionContainer = null;
    }

    public isCompletionOpen() {
        return this.completionContainer !== null;
    }

    public highlightCompletion(index: number) {
        if (!this.completionContainer) return;
        const children = this.completionContainer.children;
        for (let i = 0; i < children.length; i++) {
            const el = children[i] as HTMLElement;
            el.classList.toggle('completion-active', i === index);
            if (i === index) el.scrollIntoView({ block: 'nearest' });
        }
    }
}