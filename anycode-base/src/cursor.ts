import { AnycodeLine } from './utils';

export function removeCursor() {
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
}

export function moveCursor(
    lineDiv: HTMLElement,
    column: number,
    focus: boolean = true
) {
    // Ensure the lineDiv is connected to the DOM before proceeding
    if (!lineDiv.isConnected) {
        console.warn('moveCursor: lineDiv is not connected to DOM');
        return;
    }
    
    var character: number = column;
    
    const chunks = Array.from(lineDiv.children).map(l => l as AnycodeLine);
    let chunkCharacter = 0;
    let chunk: Element | null = null;

    for (let chunkNode of chunks) {
        const chunkLength = chunkNode.textContent!.length;
        if (chunkLength === 0) {
            chunk = chunkNode;
            chunkCharacter = 0;
            break;
        }
        if (character < chunkLength) {
            chunk = chunkNode;
            chunkCharacter = character;
            break;
        } else {
            character -= chunkLength;
        }
    }

    if (!chunk) {
        chunk = chunks[chunks.length - 1];
        chunkCharacter = chunk?.textContent?.length ?? 0;
    }
    
    if (!chunk) {
        return
    }

    const ch = chunk.firstChild || chunk;
    
    // Ensure we're working with the correct document context
    const doc = ch.ownerDocument || document;
    const range = doc.createRange();
    range.setStart(ch, chunkCharacter);
    range.collapse(true);
    
    // Check if the range is already the same as the current selection
    // Do this early to avoid unnecessary scrolling and DOM operations
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
        const currentRange = sel.getRangeAt(0);
        if (currentRange.startContainer === range.startContainer &&
            currentRange.startOffset === range.startOffset &&
            currentRange.collapsed === range.collapsed) {
            // console.log('moveCursor: range already the same, skipping update');
            return;
        }
    }
    
    if (focus) {
        const scrollable = lineDiv?.parentElement?.parentElement;
        scrollCursorIntoViewVertically(scrollable!, lineDiv);
        
        const buttonsDivs = scrollable!.querySelectorAll(".buttons div");
        const gutters = scrollable!.querySelectorAll(".gutter .ln");
        const codeElement = scrollable!.querySelector(".code") as HTMLElement | null;
        
        const buttonsWidth = buttonsDivs.length > 0 ? 
            buttonsDivs[0].getBoundingClientRect().width : 0;
        const gutterWidth = gutters.length > 0 ? 
            gutters[0].getBoundingClientRect().width : 0;
        const codePaddingLeft = codeElement ? 
            parseFloat(getComputedStyle(codeElement).paddingLeft) : 0;
        
        const cursorNode = ch.firstChild || ch;
        const cursorOffset = chunkCharacter;
    
        scrollCursorIntoViewHorizontally(
            scrollable!, cursorNode, cursorOffset, 
            buttonsWidth + gutterWidth + codePaddingLeft
        );
    }

    if (sel) {
        // Ensure the range is valid and in the same document as the selection
        try {
            sel.removeAllRanges();
            sel.addRange(range);
        } catch (error) {
            console.warn('Failed to add range to selection:', error);
        }
    }
}

function scrollCursorIntoViewVertically(
    container: HTMLElement, lineDiv: HTMLElement
) {
    const containerRect = container.getBoundingClientRect();
    const lineRect = lineDiv.getBoundingClientRect();

    if (lineRect.top < containerRect.top) {
        container.scrollTop -= (containerRect.top - lineRect.top);
    } else if (lineRect.bottom > containerRect.bottom) {
        container.scrollTop += (lineRect.bottom - containerRect.bottom);
    }
}

function scrollCursorIntoViewHorizontally(
    container: HTMLElement, 
    cursorNode: Node, 
    cursorOffset: number, 
    leftPlus: number, 
) {

    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);    
    if (isSafari) {
        // Safari-specific multiple carets bug: 
        // temporarily disable scrolling
        return;
    }
    
    // Ensure we're working with the correct document context
    const doc = cursorNode.ownerDocument || document;
    const range = doc.createRange();
    range.setStart(cursorNode, cursorOffset);
    range.collapse(true);

    const cursorRect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const leftVisible = containerRect.left + leftPlus;
    const rightVisible = containerRect.right;

    if (cursorRect.left < leftVisible) {
        const delta = leftVisible - cursorRect.left;
        container.scrollLeft -= delta;
    } else if (cursorRect.right > rightVisible) {
        const delta = cursorRect.right - rightVisible;
        container.scrollLeft += delta;
    }
}
