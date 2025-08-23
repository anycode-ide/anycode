import { AnycodeLine, Pos } from "./utils"; 

export function getPosFromMouse(e: MouseEvent): Pos | null {
    
    const target = e.target as Node;
    if (!target) return null;

    let pos: { offsetNode: Node; offset: number } | null = null;

    if (document.caretPositionFromPoint) {
        const caret = document.caretPositionFromPoint(e.clientX, e.clientY);
        if (caret) {
            pos = { offsetNode: caret.offsetNode, offset: caret.offset };
        }
    } else if ((document as any).caretRangeFromPoint) {
        const range = (document as any).caretRangeFromPoint(e.clientX, e.clientY);
        if (range) {
            pos = { offsetNode: range.startContainer, offset: range.startOffset };
        }
    }

    if (!pos || !pos.offsetNode) return null;

    return resolvePosition(pos.offsetNode, pos.offset)
}

function resolvePosition(node: Node, nodeOffset: number): Pos | null {
    // corner case, out of row, on buttons column
    if (node instanceof HTMLElement && node.classList.contains("bt")) {
        const lineStr = node.getAttribute("data-line");
        if (!lineStr) return null;
        let row = parseInt(lineStr) ; 
        return { row, col: 0 }; 
    }

    // corner case, out of row, on line numbers column
    if (node.parentNode && node.parentNode instanceof HTMLElement 
        && node.parentNode.classList.contains("ln")) {
        const lineStr = node.parentNode.getAttribute("data-line");
        if (!lineStr) return null;
        let row = parseInt(lineStr); 
        return { row, col: 0 }; 
    }
    
    // corner case, whole row selected
    if (node instanceof HTMLElement && node.classList.contains("line")) {
        const lineDiv = node as AnycodeLine;
        return { row: lineDiv.lineNumber, col: 0 }; 
    }

    const lineDiv = (
        node instanceof HTMLElement
            ? node.closest(".line")
            : node.parentElement?.closest(".line")
    ) as AnycodeLine | null;

    if (!lineDiv || typeof lineDiv.lineNumber !== "number") return null;
    
    if (lineDiv.childNodes.length === 1) {
        const content = lineDiv.childNodes[0].textContent ?? '';
        if (content === '' || content === '\u200B') {
            return { row: lineDiv.lineNumber, col: 0 }; 
        }
    }

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
