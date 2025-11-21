import { Code, HighlighedNode } from "./code";
import { AnycodeLine, objectHash, minimize, findNodeAndOffset, findPrevWord } from "./utils";
import { moveCursor, removeCursor } from "./cursor";
import { EditorState, EditorSettings } from "./editor";
import {
    Selection, getSelection,
    setSelectionFromOffsets as renderSelection,
} from "./selection";
import { Completion, completionKindMap } from "./lsp";
import { Search, SearchMatch } from "./search";

export class Renderer {
    private container: HTMLDivElement;
    private buttonsColumn: HTMLDivElement;
    private gutter: HTMLDivElement;
    private codeContent: HTMLDivElement;
    private maxLineWidth = 0;
    private completionContainer: HTMLDivElement | null = null;
    private searchContainer: HTMLDivElement | null = null;
    private searchMatchLabel: HTMLDivElement | null = null;

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

    public render(state: EditorState, search?: Search) {
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
        if (!search || !search.isActive() || !search.isFocused()) {
            if (!selection || selection.isEmpty()) {
                const { line, column } = code.getPosition(offset);
                this.renderCursor(line, column, false);
            } else {
                this.renderSelection(code, selection!);
            }
        }

        // render search highlights
        if (search && search.isActive()) {
            this.updateSearchHighlights(search);
        }
    }

    public renderScroll(state: EditorState, search?: Search) {
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
    
        const needFullRerender =
            currentStartLine === -1 ||
            startLine >= currentEndLine ||
            endLine <= currentStartLine ||
            Math.abs(startLine - currentStartLine) > buffer * 2 ||
            Math.abs(endLine - currentEndLine) > buffer * 2;
    
        if (needFullRerender) {
            this.render(state, search);
            return;
        }
    
        // delete rows above
        while (currentStartLine < startLine && this.codeContent.children.length > 2) {
            this.codeContent.removeChild(this.codeContent.children[1]);
            this.gutter.removeChild(this.gutter.children[1]);
            this.buttonsColumn.removeChild(this.buttonsColumn.children[1]);
            currentStartLine++;
            changed = true;
        }
    
        // delete rows below
        while (currentEndLine > endLine && this.codeContent.children.length > 2) {
            this.codeContent.removeChild(this.codeContent.children[this.codeContent.children.length - 2]);
            this.gutter.removeChild(this.gutter.children[this.gutter.children.length - 2]);
            this.buttonsColumn.removeChild(this.buttonsColumn.children[this.buttonsColumn.children.length - 2]);
            currentEndLine--;
            changed = true;
        }
    
    
        // add roes above 
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
    
        // add rows below
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
        
        // render cursor or selection
        if (!search || !search.isActive() || !search.isFocused()) {
            if (!selection || selection.isEmpty()) {
                const { line, column } = code.getPosition(offset);
                this.renderCursor(line, column, false);
            } else {
                this.renderSelection(code, selection!);
            }
        }

        // render search highlights
        if (search && search.isActive()) {
            this.updateSearchHighlights(search);
        }
        
        if (!changed) return;
    
        // update spacers
        const topHeight = Math.round(startLine * lineHeight);
        const bottomHeight = Math.round(Math.max(0, (totalLines - endLine) * lineHeight));
    
        topSpacer.style.height = `${topHeight}px`;
        bottomSpacer.style.height = `${bottomHeight}px`;
    
        gutterTopSpacer.style.height = `${topHeight}px`;
        gutterBottomSpacer.style.height = `${bottomHeight}px`;
    
        btnTopSpacer.style.height = `${topHeight}px`;
        btnBottomSpacer.style.height = `${bottomHeight}px`;
    }

    public renderChanges(state: EditorState, search?: Search) {
        console.log("renderChanges");
        // console.time('updateChanges');
    
        const { code, offset, selection, errorLines, settings } = state;
        const totalLines = code.linesLength();
        const { startLine, endLine } = this.getVisibleRange(totalLines, settings);
    
        const lines = this.getLines();
    
        if (lines.length === 0) { 
            this.render(state); 
            // console.timeEnd('updateChanges');
            return; 
        }
    
        const oldStartLine = lines[0].lineNumber;
        const oldEndLine = lines[lines.length - 1].lineNumber + 1;
    
        if (oldStartLine !== startLine || oldEndLine !== endLine) {
            // Full render if viewport changed
            this.render(state);
            // console.timeEnd('updateChanges');
            return;
        }
        
        // Update only changed lines
        for (let i = startLine; i < endLine; i++) {
            const nodes = code.getLineNodes(i);
            const newHash = objectHash(nodes).toString();
    
            const existingLine = lines.find(line => line.lineNumber === i);
    
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

        // render search highlights
        if (search && search.isActive()) {
            this.updateSearchHighlights(search);
        }

        // render cursor or selection
        if (!search || !search.isActive() || !search.isFocused()) {
            if (!selection || selection.isEmpty()) {
                const { line, column } = code.getPosition(offset);
                this.renderCursor(line, column, true);
            } else {
                this.renderSelection(code, selection!);
            }
        }

        // console.timeEnd('updateChanges');
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
        // const hasError = errorLines.has(lineNumber);

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

        if (nodes.length === 0 || (nodes.length === 1 && nodes[0].text === "\u200B")) {
            wrapper.appendChild(document.createElement('br'));
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
                requestAnimationFrame(() => {
                    moveCursor(lineDiv, column, focus)
                });
            }
        } else {
            removeCursor();
        }
    }

    public renderSelection(code: Code, selection: Selection) {
        if (selection.isEmpty()) return;

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
        if (this.codeContent.children.length <= 2) return null;
        const firstLine = this.codeContent.children[1] as AnycodeLine;
        const firstLineNumber = firstLine.lineNumber;
        const idx = lineNumber - firstLineNumber;
        if (idx < 0 || idx >= this.codeContent.children.length - 2) return null;
        return this.codeContent.children[idx + 1] as AnycodeLine;
    }

    public getStartLine(): AnycodeLine | null {
        const lines = this.getLines();
        return lines.length > 0 ? lines[0] : null;
    }

    public getEndLine(): AnycodeLine | null {
        const lines = this.getLines();
        return lines.length > 0 ? lines[lines.length - 1] : null;
    }

    public focus(state: EditorState, focusLine: number | null = null): boolean {
        const { code, offset, settings } = state;
        if (!code) return false;
    
        let { line } = code.getPosition(offset);
        if (focusLine !== null) line = focusLine;
    
        const cursorTop = line * settings.lineHeight;
        const cursorBottom = cursorTop + settings.lineHeight;
    
        const viewportTop = this.container.scrollTop;
        const viewportBottom = viewportTop + this.container.clientHeight;
        
        const bottomPaddingLines = 5;
        const padding = settings.lineHeight * bottomPaddingLines;
        let targetScrollTop = viewportTop;
    
        if (cursorTop < viewportTop) {
            targetScrollTop = cursorTop;
        } else if (cursorBottom > viewportBottom - padding) {
            targetScrollTop = cursorBottom - this.container.clientHeight + padding;
        }
    
        const tolerance = 2;
        if (Math.abs(targetScrollTop - viewportTop) > tolerance) {
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
    }

    public focusSearchInput() {
        if (this.searchContainer) {
            const inputField = this.searchContainer.querySelector('.search-input') as HTMLTextAreaElement;
            if (inputField) {
                inputField.focus();
            }
        }
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

    renderHighlights(
        lineDiv: AnycodeLine, 
        startColumn: number, 
        endColumn: number, 
        selected: boolean
    ) {
        const spans = Array.from(lineDiv.querySelectorAll('span'));
        let charCount = 0;
        
        for (let span of spans) {
            if (!span.textContent) continue;
            
            const textLength = span.textContent.length;
    
            // Check if the current span is fully within the range
            if (charCount + textLength <= startColumn || charCount >= endColumn) {
                charCount += textLength; // Skip spans outside the range
                continue;
            }
    
            if (charCount >= startColumn && charCount + textLength <= endColumn) {
                // Fully matched span
                if (!span.classList.contains('highlight'))
                    span.classList.add('highlight');
                if (selected && !span.classList.contains('selected'))
                    span.classList.add('selected');
            } else {
                // Partially matched span
                const startOffset = Math.max(0, startColumn - charCount);
                const endOffset = Math.min(textLength, endColumn - charCount);
    
                const beforeText = span.textContent.slice(0, startOffset);
                const highlightedText = span.textContent.slice(startOffset, endOffset);
                const afterText = span.textContent.slice(endOffset);
    
                const fragment = document.createDocumentFragment();
    
                if (beforeText) {
                    const beforeSpan = span.cloneNode(false);
                    beforeSpan.textContent = beforeText;
                    fragment.appendChild(beforeSpan);
                }
    
                if (highlightedText) {
                    const highlightSpan = span.cloneNode(false) as HTMLElement;
                    if (!highlightSpan.classList.contains('highlight'))
                        highlightSpan.classList.add('highlight');
                    if (selected && !highlightSpan.classList.contains('selected'))
                        highlightSpan.classList.add('selected');
                    highlightSpan.textContent = highlightedText;
                    fragment.appendChild(highlightSpan);
                }
    
                if (afterText) {
                    const afterSpan = span.cloneNode(false);
                    afterSpan.textContent = afterText;
                    fragment.appendChild(afterSpan);
                }
    
                span.replaceWith(fragment);
            }
    
            charCount += textLength;
        }
    }

    public removeAllHighlights(search: Search) {
        const pattern = search.getPattern();
        const patternLines = pattern.split(/\r?\n/);
        const isMultiline = patternLines.length > 1;
        const matches = search.getMatches();
        
        for (let index = 0; index < matches.length; index++) {
            const m = matches[index];
            
            if (!isMultiline) {
                // Single-line: remove highlight from first line only
                let line = this.getLine(m.line);
                if (line) {
                    this.removeHighlights(line);
                }
            } else {
                // Multiline: remove highlights from all lines of the pattern
                const firstLine = this.getLine(m.line);
                if (firstLine) {
                    this.removeHighlights(firstLine);
                }
                
                // Remove highlights from intermediate and last lines
                for (let j = 1; j < patternLines.length; j++) {
                    const lineIndex = m.line + j;
                    const line = this.getLine(lineIndex);
                    if (line) {
                        this.removeHighlights(line);
                    }
                }
            }
        }
    }

    public removeSelectedHighlight(search: Search) {
        const pattern = search.getPattern();
        const patternLines = pattern.split(/\r?\n/);
        const isMultiline = patternLines.length > 1;
        const matches = search.getMatches();
        const selectedIndex = search.getSelected();

        // Only remove the highlight from the currently selected match
        if (selectedIndex >= 0 && selectedIndex < matches.length) {
            const match = matches[selectedIndex];
            
            if (!isMultiline) {
                // Single-line: remove .selected class from first line only
                let line = this.getLine(match.line);
                if (line) {
                    // Only remove the .selected class, leave .highlight in place
                    this.removeHighlights(line, true);
                }
            } else {
                // Multiline: remove .selected class from all lines of the pattern
                const firstLine = this.getLine(match.line);
                if (firstLine) {
                    this.removeHighlights(firstLine, true);
                }
                
                // Remove .selected class from intermediate and last lines
                for (let j = 1; j < patternLines.length; j++) {
                    const lineIndex = match.line + j;
                    const line = this.getLine(lineIndex);
                    if (line) {
                        this.removeHighlights(line, true);
                    }
                }
            }
        }
    }

    private removeHighlights(lineDiv: AnycodeLine, selectedOnly: boolean = false) {
        const highlightedSpans = Array.from(lineDiv.querySelectorAll('span.highlight, span.selected'));
    
        for (const span of highlightedSpans) {
            span.classList.remove('highlight');
            if (selectedOnly) span.classList.remove('selected');
            else span.classList.remove('highlight', 'selected');
        }

        // After removing highlight classes, merge adjacent spans with the same class list
        let i = 0;
        while (i < lineDiv.childNodes.length - 1) {
            const current = lineDiv.childNodes[i] as ChildNode;
            const next = lineDiv.childNodes[i + 1] as ChildNode;
            
            if (
                current.nodeType === Node.ELEMENT_NODE &&
                next.nodeType === Node.ELEMENT_NODE
            ) {
                const currentEl = current as HTMLElement;
                const nextEl = next as HTMLElement;
                if (
                    currentEl.tagName === 'SPAN' &&
                    nextEl.tagName === 'SPAN' &&
                    currentEl.className === nextEl.className
                ) {
                    // Concatenate text and remove the next span
                    currentEl.textContent = (currentEl.textContent || '') + (nextEl.textContent || '');
                    lineDiv.removeChild(nextEl);
                    continue;
                }
            }
            i++;
        }
    }

    public removeSearch() {
        let searchContainer = document.querySelector('.search');
        if (searchContainer) searchContainer.remove();
        this.searchMatchLabel = null;
    }

    public updateSearchHighlights(search: Search) {
        const pattern = search.getPattern();
        const matches = search.getMatches();
        const selected = search.getSelected();
        const patternLines = pattern.split(/\r?\n/);
        const isMultiline = patternLines.length > 1;

        if (!pattern) {
            this.updateSearchLabel('');
        } else if (matches.length === 0) {
            this.updateSearchLabel('No matches');
        } else {
            this.updateSearchLabel(`Match ${selected + 1} of ${matches.length}`);
        }

        for (let i = 0; i < matches.length; i++) {
            const match = matches[i];
            const isSelected = i === selected;

            if (!isMultiline) {
                // Single-line search
                let line = this.getLine(match.line);
                if (!line) continue;

                this.renderHighlights(line, match.column, match.column + pattern.length, isSelected);
            } else {
                // Multiline search
                const firstLinePattern = patternLines[0];
                const remainingLines = patternLines.slice(1);

                // Highlight first line (from match.column to end of first pattern line)
                let firstLineDiv = this.getLine(match.line);
                if (firstLineDiv) {
                    const firstLineEnd = match.column + firstLinePattern.length;
                    this.renderHighlights(firstLineDiv, match.column, firstLineEnd, isSelected);
                }

                // Highlight intermediate lines (full line match)
                for (let j = 0; j < remainingLines.length - 1; j++) {
                    const lineIndex = match.line + j + 1;
                    let lineDiv = this.getLine(lineIndex);
                    if (!lineDiv) continue;

                    // Use pattern line length since matches correspond to text
                    const lineLength = patternLines[j + 1].length;
                    this.renderHighlights(lineDiv, 0, lineLength, isSelected);
                }

                // Highlight last line (from start to end of last pattern line)
                if (remainingLines.length > 0) {
                    const lastLineIndex = match.line + remainingLines.length;
                    let lastLineDiv = this.getLine(lastLineIndex);
                    if (lastLineDiv) {
                        const lastLinePattern = remainingLines[remainingLines.length - 1];
                        const lastLineEnd = lastLinePattern.length;
                        this.renderHighlights(lastLineDiv, 0, lastLineEnd, isSelected);
                    }
                }
            }
        }
    }

    public renderSearch(
        search: Search,
        state: EditorState,
        handlers?: {
            onKeyDown?: (event: KeyboardEvent, input: HTMLTextAreaElement) => void,
            onInputChange?: (value: string) => void,
        }
    ) {
        if (this.searchContainer) {
            this.removeAllHighlights(search);
            this.searchContainer.remove();
            this.searchMatchLabel = null;
            // return;
        }

        // Create a container for the search UI
        this.searchContainer = document.createElement('div');
        this.searchContainer.className = 'search';
        this.searchContainer.style.display = 'flex';
        this.searchContainer.style.flexDirection = 'column';
        this.searchContainer.style.position = 'fixed';

        // Create a search textarea field for multiline search (full width)
        const inputField = document.createElement('textarea');
        inputField.className = 'search-input';
        inputField.placeholder = 'Search';
        inputField.value = search.getPattern();
        inputField.rows = 1;

        inputField.addEventListener('focus', () => {
            console.log('[Search] input field focused');
            search.setFocused(true);
        });

        inputField.addEventListener('blur', () => {
            console.log('[Search] input field blurred');
            search.setFocused(false);
        });

        // Create close button
        const closeButton = document.createElement('button');
        closeButton.className = 'search-close-button';
        closeButton.innerHTML = '&times;'; // × symbol
        closeButton.title = 'Close search';

        // Add click handler for close button
        closeButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (handlers && handlers.onKeyDown) {
                let esc = { key: 'Escape', bubbles: true, cancelable: true };
                handlers.onKeyDown(new KeyboardEvent('keydown', esc), inputField as HTMLTextAreaElement);
            } else {
                this.removeAllHighlights(search);
                this.removeSearch();
                search.clear();
            }
        });

        // Create a label to display match information
        const matchLabel = document.createElement('div');
        matchLabel.className = 'search-label';
        matchLabel.textContent = '';
        matchLabel.style.userSelect = 'none';
        matchLabel.style.pointerEvents = 'none';

        // Create previous button
        const prevButton = document.createElement('button');
        prevButton.className = 'search-button';
        prevButton.innerHTML = '&#8593;'; // Up arrow
        prevButton.title = 'Previous match';

        // Create next button
        const nextButton = document.createElement('button');
        nextButton.className = 'search-button';
        nextButton.innerHTML = '&#8595;'; // Down arrow
        nextButton.title = 'Next match';

        // Add click handlers for buttons
        prevButton.addEventListener('click', () => {
            let matches = search.getMatches();
            if (matches.length === 0) return;
            this.removeSelectedHighlight(search);
            search.selectPrev();
            this.focus(state, search.getSelectedMatch()?.line);
            this.updateSearchHighlights(search);
            search.setNeedsFocus(true);
            this.focusSearchInput();
        });

        nextButton.addEventListener('click', () => {
            let matches = search.getMatches();
            if (matches.length === 0) return;
            this.removeSelectedHighlight(search);
            search.selectNext();
            this.focus(state, search.getSelectedMatch()?.line);
            this.updateSearchHighlights(search);
            search.setNeedsFocus(true);
            this.focusSearchInput();
        });

        // Create controls row
        const controlsRow = document.createElement('div');
        controlsRow.style.display = 'flex';
        controlsRow.style.alignItems = 'center';
        controlsRow.style.justifyContent = 'space-between';
        
        // Left side: close button and up and down buttons
        const leftControls = document.createElement('div');
        leftControls.style.display = 'flex';
        leftControls.style.alignItems = 'center';
        leftControls.appendChild(prevButton);
        leftControls.appendChild(nextButton);
        leftControls.appendChild(closeButton);
        
        controlsRow.appendChild(matchLabel);
        controlsRow.appendChild(leftControls);
        
        this.searchMatchLabel = matchLabel;

        // Wire input and keyboard handlers
        if (handlers && handlers.onKeyDown) {
            inputField.addEventListener('keydown', (e) => 
                handlers!.onKeyDown!(e, inputField as HTMLTextAreaElement));
        }

        if (handlers && handlers.onInputChange) {
            inputField.addEventListener('input', (e) => {
                inputField.style.height = 'auto';
                const newHeight = Math.min(inputField.scrollHeight, 200);
                inputField.style.height = `${newHeight}px`;
                handlers!.onInputChange!(inputField.value);
            });
            inputField.addEventListener('beforeinput', (e) => e.stopPropagation());
        }

        // Initial height adjustment
        // inputField.style.height = 'auto';
        // const initialHeight = Math.min(inputField.scrollHeight, 200);
        // inputField.style.height = `${initialHeight}px`;

        // Add textarea and controls row to container
        this.searchContainer.appendChild(inputField);
        this.searchContainer.appendChild(controlsRow);
        this.container!.appendChild(this.searchContainer);

        inputField.focus();

        this.updateSearchHighlights(search);
    }

    public updateSearchLabel(text: string) {
        if (!this.searchMatchLabel) return;
        if (this.searchMatchLabel.textContent !== text) {
            this.searchMatchLabel.textContent = text;
        }
    }
}