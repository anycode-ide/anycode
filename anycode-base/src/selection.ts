import { AnycodeLine, Pos } from "./utils"; 
import { Code } from "./code";

export class Selection {
    public anchor: number | null ;
    public cursor: number | null ;

    constructor(anchor: number, cursor: number) {
        this.anchor = anchor;
        this.cursor = cursor;
    }
    
    public reset(pos: number) {
        this.anchor = pos;
        this.cursor = pos;
    }
    
    public updateCursor(pos: number) {
        this.cursor = pos;
    }
    
    fromCursor(cursor: number): Selection {
        return new Selection(this.anchor!, cursor);
    }

    public isEmpty(): boolean {
        return this.anchor === this.cursor;
    }
    
    public nonEmpty(): boolean {
        return !this.isEmpty();
    }

    public sorted(): [number, number] {
        return this.anchor! <= this.cursor! 
            ? [this.anchor!, this.cursor!] 
            : [this.cursor!, this.anchor!];
    }

    public get start(): number {
        return Math.min(this.anchor!, this.cursor!);
    }

    public get end(): number {
        return Math.max(this.anchor!, this.cursor!);
    }

    public equals(other: Selection): boolean {
        const [startA, endA] = this.sorted();
        const [startB, endB] = other.sorted();
        return startA === startB && endA === endB;
    }

    public clone(): Selection {
        return new Selection(this.anchor!, this.cursor!);
    }
}

export function getSelection(): { start: Pos, end: Pos } | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
        return null;
    }

    const range = sel.getRangeAt(0);
    if (range.collapsed) {
        return null;
    }

    const start = resolveAbsoluteOffset(range.startContainer, range.startOffset);
    const end = resolveAbsoluteOffset(range.endContainer, range.endOffset);

    if (start == null || end == null) {
        return null;
    }

    return { start, end };
}

export function resolveAbsoluteOffset(node: Node, nodeOffset: number): Pos | null {
    // corner case, whole row selected
    if (
        node instanceof HTMLElement &&
        node.classList.contains("line")
    ) {
        const lineDiv = node as AnycodeLine;
        return { row: lineDiv.lineNumber, col: 0 }; 
    }

    const lineDiv = (
        node instanceof HTMLElement
            ? node.closest(".line")
            : node.parentElement?.closest(".line")
    ) as AnycodeLine | null;

    if (!lineDiv || typeof lineDiv.lineNumber !== "number") return null;

    let offset = 0;
    let found = false;

    for (const child of lineDiv.childNodes) {
        if (found) break;

        if (child.contains(node)) {
            if (child === node) {
                offset += nodeOffset;
            } else {
                for (const sub of child.childNodes) {
                    if (sub === node) {
                        offset += nodeOffset;
                        found = true;
                        break;
                    } else {
                        offset += sub.textContent?.length ?? 0;
                    }
                }
            }
            found = true;
        } else {
            offset += child.textContent?.length ?? 0;
        }
    }

    return { row: lineDiv.lineNumber, col: offset }; 
}


interface DOMPosition {
    node: Node;
    offset: number;
}

function resolveDOMPosition(
    offset: number, lines: AnycodeLine[], code: Code
): DOMPosition | null {
    for (const line of lines) {
        const lineOffset = code.getOffset(line.lineNumber, 0);
        const lineLength = Array.from(line.childNodes)
            .map(n => n.textContent?.length ?? 0)
            .reduce((a, b) => a + b, 0);

        if (offset >= lineOffset && offset <= lineOffset + lineLength) {
            let remaining = offset - lineOffset;

            for (const span of line.childNodes) {
                const len = span.textContent?.length ?? 0;
                if (remaining <= len) {
                    const textNode = span.firstChild;
                    if (!textNode) return null;
                    return { node: textNode, offset: remaining };
                }
                remaining -= len;
            }
        }
    }
    return null;
}

export function setSelectionFromOffsets(
    selection: Selection, lines: AnycodeLine[], code: Code
) {    
    // console.log("setSelectionFromOffsets ", selection);

    if (lines.length === 0) return;

    // temporary fix, remove invalid selection if it points to a div.code container
    let currentWindowSelection = window.getSelection();
    if (currentWindowSelection && currentWindowSelection.rangeCount > 0) {
        let range = currentWindowSelection.getRangeAt(0);
        if (range) {
            let startContainer = range.startContainer;
            let endContainer = range.endContainer;
            if ((startContainer instanceof HTMLElement && startContainer.classList.contains('code')) ||
                (endContainer instanceof HTMLElement && endContainer.classList.contains('code'))) {
                currentWindowSelection.removeAllRanges();
                // return;
            }
        }
    }

    // Check if the same selection is already active
    const currentSelection = getSelection();
    // console.log('currentSelection', currentSelection);
    if (currentSelection) {
        const currentStartOffset = code.getOffset(currentSelection.start.row, currentSelection.start.col);
        const currentEndOffset = code.getOffset(currentSelection.end.row, currentSelection.end.col);
        const [newStart, newEnd] = selection.sorted();

        if (currentStartOffset === newStart && currentEndOffset === newEnd) {
            // console.log('Selection is already set, skipping');
            return;
        }
    }

    
    // Ensure all lines are connected to the DOM before proceeding
    for (const line of lines) {
        if (!line.isConnected) {
            console.warn('setSelectionFromOffsets: line is not connected to DOM');
            return;
        }
    }

    const firstLine = lines[0];
    const lastLine = lines[lines.length - 1];

    const visibleStart = code.getOffset(firstLine.lineNumber, 0);
    const visibleEnd =
        code.getOffset(lastLine.lineNumber, 0) +
        Array.from(lastLine.childNodes)
            .map((n) => n.textContent?.length ?? 0)
            .reduce((a, b) => a + b, 0);

    const [selectionStart, selectionEnd] = selection.sorted(); // DOM needs sorted

    const clamped = new Selection(
        Math.max(selectionStart, visibleStart),
        Math.min(selectionEnd, visibleEnd)
    );

    const startPos = resolveDOMPosition(clamped.start, lines, code);
    const endPos = resolveDOMPosition(clamped.end, lines, code);
    if (!startPos || !endPos) return;

    // Ensure we're working with the correct document context
    const doc = startPos.node.ownerDocument || document;
    const range = doc.createRange();
    const sel = window.getSelection();
    if (!sel) return;

    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);

    // Ensure the range is valid and in the same document as the selection
    try {
        sel.removeAllRanges();
        sel.addRange(range);
        // console.log("addRange", range);
    } catch (error) {
        console.warn('Failed to add range to selection:', error);
    }
}