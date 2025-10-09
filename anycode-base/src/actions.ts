import type { Code } from "./code";
import { Selection } from "./selection";
import { getIndentation, getPrevGraphemeIndex, getNextGraphemeIndex } from "./utils";

export enum Action {
    // Navigation
    ARROW_LEFT = 'ARROW_LEFT',
    ARROW_RIGHT = 'ARROW_RIGHT',
    ARROW_UP = 'ARROW_UP',
    ARROW_DOWN = 'ARROW_DOWN',
    ARROW_LEFT_ALT = 'ARROW_LEFT_ALT',
    ARROW_RIGHT_ALT = 'ARROW_RIGHT_ALT',
    ESC = 'ESC',

    // Editing
    BACKSPACE = 'BACKSPACE',
    DELETE = 'DELETE',
    ENTER = 'ENTER',
    TAB = 'TAB',
    UNTAB = 'UNTAB',
    TEXT_INPUT = 'TEXT_INPUT',

    // Shortcuts
    UNDO = 'UNDO',
    REDO = 'REDO',
    SELECT_ALL = 'SELECT_ALL',
    COPY = 'COPY',
    PASTE = 'PASTE',
    CUT = 'CUT',
    DUPLICATE = 'DUPLICATE',
    COMMENT = 'COMMENT',
}

export type ActionContext = {
    offset: number;
    code: Code;
    selection?: Selection;
    event?: KeyboardEvent
};

export type ActionResult = {
    changed: boolean;
    ctx: ActionContext;
};

export const executeAction = async (
    action: Action, ctx: ActionContext
): Promise<ActionResult> => {
    switch (action) {
        // Navigation
        case Action.ARROW_LEFT: return moveArrowLeft(ctx, false);
        case Action.ARROW_RIGHT: return moveArrowRight(ctx, false);
        case Action.ARROW_LEFT_ALT: return moveArrowLeft(ctx, true);
        case Action.ARROW_RIGHT_ALT: return moveArrowRight(ctx, true);
        case Action.ARROW_UP: return moveArrowUp(ctx);
        case Action.ARROW_DOWN:  return moveArrowDown(ctx);
        case Action.ESC:  return handleEsc(ctx);

        // Editing
        case Action.BACKSPACE: return handleBackspace(ctx);
        case Action.ENTER: return handleEnter(ctx);
        case Action.TAB: return handleTab(ctx);
        case Action.UNTAB: return handleUnTab(ctx);
        case Action.TEXT_INPUT: return handleTextInput(ctx);

        // Shortcuts
        case Action.UNDO: return handleUndo(ctx);
        case Action.REDO: return handleRedo(ctx);
        case Action.SELECT_ALL: return handleSelectAll(ctx);
        case Action.COPY: return await handleCopy(ctx);
        case Action.PASTE: return await handlePaste(ctx);
        case Action.CUT: return await handleCut(ctx);
        case Action.DUPLICATE: return await handleDuplicate(ctx);
        case Action.COMMENT: return handleToggleComment(ctx);
        default:
            return { ctx, changed: false };
    }
};

export const handleTextInput = (ctx: ActionContext): ActionResult => {
    ctx.code.tx();
    ctx.code.setStateBefore(ctx.offset, ctx.selection);
    
    if (ctx.selection?.nonEmpty()) {
        removeSelection(ctx);
    }
    
    let text = ctx.event!.key;
    ctx.code.insert(text, ctx.offset);
    ctx.offset += text.length;

    ctx.code.setStateAfter(ctx.offset, ctx.selection);
    ctx.code.commit();
    
    return { ctx, changed: true };
};

export const removeSelection = (ctx: ActionContext): ActionResult => {
    if (!ctx.selection?.nonEmpty()) return { ctx, changed: false };
    
    let [start, end] = ctx.selection.sorted();
    let len = ctx.code.length();
    if (end > len) { end = len } // todo fix end bug
    ctx.code.remove(start, end - start);
    ctx.offset = start;
    ctx.selection = undefined;
    return { ctx, changed: true };
}

export const handleBackspace = (ctx: ActionContext): ActionResult => {
    ctx.code.tx();
    ctx.code.setStateBefore(ctx.offset, ctx.selection);

    if (ctx.selection?.nonEmpty()) {
        removeSelection(ctx);
        ctx.code.setStateAfter(ctx.offset, ctx.selection);
        ctx.code.commit();
        return { ctx, changed: true };
    }

    if (ctx.offset <= 0) { return { ctx, changed: false } }

    let { line, column } = ctx.code.getPosition(ctx.offset);

    // At start of line: join with previous line by removing the newline
    if (column === 0 && line > 0) {
        ctx.offset -= 1;
        ctx.code.remove(ctx.offset, 1);
        ctx.code.setStateAfter(ctx.offset, ctx.selection);
        ctx.code.commit();
        return { ctx, changed: true };
    }

    let isRemoveIndent = column > 0 && ctx.code.getIndent() &&
        ctx.code.isOnlyIndentationBefore(line, column);

    if (isRemoveIndent) {
        // idea like
        // let start = ctx.code.getOffset(line, 0);

        // vscode like 
        let start = ctx.code.getOffset(line, 0) + ctx.code.prevIndentation(line, column);
        ctx.code.remove(start, ctx.offset - start);
        ctx.offset = start;
    } else {
        // delete previous grapheme cluster
        const { line, column } = ctx.code.getPosition(ctx.offset);
        const lineText = ctx.code.line(line);
        const prevCol = getPrevGraphemeIndex(lineText, column);
        const removeLen = column - prevCol;
        ctx.offset -= removeLen;
        ctx.code.remove(ctx.offset, removeLen);
    }

    ctx.code.setStateAfter(ctx.offset, ctx.selection);
    ctx.code.commit();

    return { ctx, changed: true };
};

export const handleEnter = (ctx: ActionContext): ActionResult => {
    ctx.code.tx();
    ctx.code.setStateBefore(ctx.offset, ctx.selection);

    if (ctx.selection?.nonEmpty()) {
        removeSelection(ctx);
    }

    const { line, column } = ctx.code.getPosition(ctx.offset);
    const currentLine = ctx.code.line(line);

    const indent = getIndentation(currentLine, column);
    const newlineWithIndent = '\n' + indent;

    ctx.code.insert(newlineWithIndent, ctx.offset);
    ctx.offset += newlineWithIndent.length;
    
    ctx.selection = undefined;
    ctx.code.setStateAfter(ctx.offset, ctx.selection);
    ctx.code.commit();

    return { ctx, changed: true };
};

export const handleUndo = (ctx: ActionContext): ActionResult => {
    const transaction = ctx.code.undo();

    if (transaction) {
        if (transaction.stateBefore) { 
            // use state before to restore cursor and selection
            ctx.offset = transaction.stateBefore.offset;
            ctx.selection = transaction.stateBefore.selection;
        } else {
            // calculate new cursor position
            for (const edit of transaction.edits) {
                if (edit.operation === 0) {
                    ctx.offset = edit.start;
                } else if (edit.operation === 1) {
                    ctx.offset = edit.start + edit.text.length;
                }
            }
            ctx.selection = undefined;
        }
        return { ctx, changed: true };
    }

    return { ctx, changed: false };
};

export const handleRedo = (ctx: ActionContext): ActionResult => {
    const transaction = ctx.code.redo();

    if (transaction) {
        if (transaction.stateAfter) {
            // use state after to restore cursor and selection
            ctx.offset = transaction.stateAfter.offset;
            ctx.selection = transaction.stateAfter.selection;
        } else {
            // calculate new cursor position
            for (const edit of transaction.edits) {
                if (edit.operation === 0) {
                    ctx.offset = edit.start + edit.text.length;
                } else if (edit.operation === 1) {
                    ctx.offset = edit.start;
                }
            }
            ctx.selection = undefined;
        }
        return { ctx, changed: true };
    }

    return { ctx, changed: false };
};

export const handleSelectAll = (ctx: ActionContext): ActionResult => {
    ctx.selection = new Selection(0, ctx.code.length());
    return { ctx, changed: true };
};

export const handleCopy = async (ctx: ActionContext): Promise<ActionResult> => {
    if (!ctx.selection || ctx.selection.isEmpty()) {
        return { ctx, changed: false };
    }

    try {
        let [start, end] = ctx.selection.sorted();
        let len = ctx.code.length();
        if (end > len) end = len; // todo: fix end bug

        let content = ctx.code.getIntervalContent2(start, end);
        await copyToClipboard(content);
        console.log('Copied:', content);
    } catch (err) {
        console.error('Failed to copy:', err);
    }

    return { ctx, changed: true };
};

async function copyToClipboard(textToCopy: string) {
    // Navigator clipboard api needs a secure context (https)
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(textToCopy);
    } else {
        // Use the 'out of viewport hidden text area' trick
        const textArea = document.createElement("textarea");
        textArea.value = textToCopy;
            
        // Move textarea out of the viewport so it's not visible
        textArea.style.position = "absolute";
        textArea.style.left = "-999999px";
            
        document.body.prepend(textArea);
        textArea.select();

        try {
            document.execCommand('copy');
        } catch (error) {
            console.error(error);
        } finally {
            textArea.remove();
        }
    }
}

export const handlePaste = async (ctx: ActionContext): Promise<ActionResult> => {
    try {
        const text = await navigator.clipboard.readText();
        if (!text) return { ctx, changed: false };

        let o = ctx.offset;

        ctx.code.tx();
        ctx.code.setStateBefore(ctx.offset, ctx.selection);

        if (ctx.selection?.nonEmpty()) {
            const [start, end] = ctx.selection!.sorted();
            ctx.code.remove(start, end - start);
            o = start;
            ctx.selection = undefined;
        }

        ctx.code.insert(text, o);
        ctx.offset = o + text.length;
        ctx.code.setStateAfter(ctx.offset, ctx.selection);
        ctx.code.commit();

        return { ctx, changed: true };
    } catch (err) {
        console.error('Failed to paste:', err);
        return { ctx, changed: false };
    }
};

export const handleDuplicate = async (ctx: ActionContext): Promise<ActionResult> => {
    let start: number, end: number, textToDuplicate: string, insertPos: number, newOffset: number;

    if (ctx.selection?.nonEmpty()) {
        // Duplicate the selected text after the selection
        [start, end] = ctx.selection.sorted();
        textToDuplicate = ctx.code.getIntervalContent2(start, end);
        insertPos = end;
        newOffset = insertPos + textToDuplicate.length;
    } else {
        // Duplicate the whole line at the cursor
        const { line, column } = ctx.code.getPosition(ctx.offset);
        start = ctx.code.getOffset(line, 0);
        // Include the line break if not last line
        if (line < ctx.code.linesLength() - 1) {
            end = ctx.code.getOffset(line + 1, 0);
        } else {
            end = ctx.code.length();
        }
        textToDuplicate = ctx.code.getIntervalContent2(start, end);
        insertPos = end;
        newOffset = ctx.code.getOffset(line + 1, column);
    }

    ctx.code.tx();
    ctx.code.setStateBefore(ctx.offset, ctx.selection);

    ctx.code.insert(textToDuplicate, insertPos);
    
    ctx.offset = newOffset;
    ctx.selection = undefined;

    ctx.code.setStateAfter(ctx.offset, ctx.selection);
    ctx.code.commit();
    return { ctx, changed: true };
}

export const handleCut = async (ctx: ActionContext): Promise<ActionResult> => {
    if (!ctx.selection || ctx.selection.isEmpty()) {
        return { ctx, changed: false };
    }

    try {
        let [start, end] = ctx.selection.sorted();
        let len = ctx.code.length();
        if (end > len) end = len; // todo: fix end bug

        let content = ctx.code.getIntervalContent2(start, end);
        await copyToClipboard(content);
        console.log('Cut:', content);

        ctx.code.tx();
        ctx.code.setStateBefore(ctx.offset, ctx.selection);

        ctx.code.remove(start, end - start);
        
        ctx.offset = start;
        ctx.selection = undefined;
        ctx.code.setStateAfter(ctx.offset, ctx.selection);
        ctx.code.commit();
        return { ctx, changed: true };
    } catch (err) {
        console.error('Failed to cut:', err);
        return { ctx, changed: false };
    }
};

export const handleTab = (ctx: ActionContext): ActionResult => {
    let linesToHandle: number[] = [];

    if (ctx.selection && !ctx.selection.isEmpty()) {
        const selectionStart = ctx.code.getPosition(ctx.selection.start);
        const selectionEnd = ctx.code.getPosition(ctx.selection.end);
        for (let i = selectionStart.line; i <= selectionEnd.line; i++) {
            linesToHandle.push(i);
        }
    } else {
        const { line } = ctx.code.getPosition(ctx.offset);
        linesToHandle = [line];
    }

    const indent = ctx.code.getIndent();
    const indentText = indent?.unit === ' ' 
        ? ' '.repeat(indent.width) 
        : '\t';

    ctx.code.tx();
    ctx.code.setStateBefore(ctx.offset, ctx.selection);

    linesToHandle.reverse();

    let indents_added = 0;
    for (const line of linesToHandle) {
        const start = ctx.code.getOffset(line, 0);
        ctx.code.insert(indentText, start);
        indents_added += 1;
    }

    if (ctx.selection && !ctx.selection.isEmpty()) {
        let [smin, smax] = ctx.selection.sorted();
        let anchor = ctx.selection.anchor!;
        let is_selection_forward = ctx.selection.anchor == smin;
        if (is_selection_forward) {
            ctx.offset += indentText.length * indents_added;
            anchor += indentText.length;
        } else {
            ctx.offset += indentText.length;
            anchor += indentText.length * indents_added;
        }
        ctx.selection = new Selection(anchor, ctx.offset);
    } else {
        ctx.offset += indentText.length;
    }

    ctx.code.setStateAfter(ctx.offset, ctx.selection);
    ctx.code.commit();
    return { ctx, changed: true };
};


export const handleUnTab = (ctx: ActionContext): ActionResult => {
    let linesToHandle: number[] = [];

    if (ctx.selection && !ctx.selection.isEmpty()) {
        const selectionStart = ctx.code.getPosition(ctx.selection.start);
        const selectionEnd = ctx.code.getPosition(ctx.selection.end);
        for (let i = selectionStart.line; i <= selectionEnd.line; i++) {
            linesToHandle.push(i);
        }
    } else {
        const { line } = ctx.code.getPosition(ctx.offset);
        linesToHandle = [line];
    }

    const indent = ctx.code.getIndent();
    const indentText = indent?.unit === ' ' ? ' '.repeat(indent.width) : '\t';

    ctx.code.tx();
    ctx.code.setStateBefore(ctx.offset, ctx.selection);

    linesToHandle.reverse();

    let lines_untabbed = 0;

    for (const line of linesToHandle) {
        const tabMatches = ctx.code.searchOnLine(line, indentText.length, indentText);
        if (tabMatches.length > 0) {
            const c = tabMatches[0];
            const start = ctx.code.getOffset(line, c);
            ctx.code.remove(start, indentText.length);
            lines_untabbed += 1;
        }
    }

    if (ctx.selection && !ctx.selection.isEmpty()) {
        let [smin, smax] = ctx.selection.sorted();
        let anchor = ctx.selection.anchor!;
        let is_selection_forward = ctx.selection.anchor == smin;
        if (is_selection_forward) {
            ctx.offset -= indentText.length * lines_untabbed;
            anchor -= indentText.length;
        } else {
            ctx.offset -= indentText.length;
            anchor -= indentText.length * lines_untabbed;
        }
        ctx.selection = new Selection(anchor, ctx.offset);
    } else {
        ctx.offset -= indentText.length;
    }

    ctx.code.setStateAfter(ctx.offset, ctx.selection);
    ctx.code.commit();

    return { ctx, changed: true };
};

export const handleToggleComment = (ctx: ActionContext): ActionResult => {
    const comment = ctx.code.getComment();
    if (!comment) return { ctx, changed: false };

    let linesToHandle: number[] = [];

    if (ctx.selection && !ctx.selection.isEmpty()) {
        const selectionStart = ctx.code.getPosition(ctx.selection.start);
        const selectionEnd = ctx.code.getPosition(ctx.selection.end);
        for (let i = selectionStart.line; i <= selectionEnd.line; i++) {
            linesToHandle.push(i);
        }
    } else {
        const { line } = ctx.code.getPosition(ctx.offset);
        linesToHandle = [line];
    }

    const commentFound = linesToHandle.some(line => {
        const lineText = ctx.code.line(line);
        const matches = ctx.code.searchOnLine(line, lineText.length, comment);
        return matches.length > 0;
    });

    ctx.code.tx();
    ctx.code.setStateBefore(ctx.offset, ctx.selection);

    linesToHandle.reverse();

    let comments_added = 0;
    let comments_removed = 0;

    for (const line of linesToHandle) {
        const lineText = ctx.code.line(line);

        if (commentFound) {
            // remove comment
            const matches = ctx.code.searchOnLine(line, lineText.length, comment);
            if (matches.length > 0) {
                const c = matches[0];
                const start = ctx.code.getOffset(line, c);
                ctx.code.remove(start, comment.length);
                comments_removed += 1;
            }
        } else {
            // insert comment
            const start = ctx.code.getOffset(line, 0);
            ctx.code.insert(comment, start);
            comments_added += 1;
        }
    }

    if (ctx.selection && !ctx.selection.isEmpty()) {
        let [smin, smax] = ctx.selection.sorted();
        let anchor = ctx.selection.anchor!;
        let is_selection_forward = ctx.selection.anchor == smin;
        if (is_selection_forward) {
            if (!commentFound) {
                ctx.offset += comment.length * comments_added;
                anchor += comment.length;
            }
            else {
                ctx.offset -= comment.length * comments_removed;
                anchor -= comment.length;
            }
        } else {
            if (!commentFound) {
                ctx.offset += comment.length;
                anchor += comment.length * comments_added;
            }
            else {
                ctx.offset -= comment.length;
                anchor -= comment.length * comments_removed;
            }
        }
        ctx.selection = new Selection(anchor, ctx.offset);
    } else {
        if (!commentFound) ctx.offset += comment.length;
        else ctx.offset -= comment.length;
    }

    ctx.code.setStateAfter(ctx.offset, ctx.selection);
    ctx.code.commit();

    return { ctx, changed: true };
};

export const moveArrowDown = (ctx: ActionContext): ActionResult => {
    if (ctx.offset < 0) return { ctx, changed: false };

    const { line, column } = ctx.code.getPosition(ctx.offset);
    if (line >= ctx.code.linesLength() - 1) return { ctx, changed: false };

    const nextLine = line + 1;
    const nextCol = Math.min(column, ctx.code.lineLength(nextLine));
    const originalOffset = ctx.offset;
    ctx.offset = ctx.code.getOffset(nextLine, nextCol);
    
    if (ctx.event?.shiftKey) {
        if (!ctx.selection) {
            // Initialize selection with original offset as anchor
            ctx.selection = new Selection(originalOffset, ctx.offset);
        } else {
            ctx.selection = ctx.selection.fromCursor(ctx.offset);
        }
    } else {
        if (ctx.selection) {
            ctx.selection.reset(ctx.offset);
        }
    }

    return { ctx, changed: false };
};

export const moveArrowUp = (ctx: ActionContext): ActionResult => {
    if (ctx.offset < 0) return { ctx, changed: false };

    const { line, column } = ctx.code.getPosition(ctx.offset);
    if (line === 0) {
        ctx.offset = ctx.code.getOffset(0, 0);
        return { ctx, changed: false };
    }

    const prevLine = line - 1;
    const prevCol = Math.min(column, ctx.code.lineLength(prevLine));
    const originalOffset = ctx.offset;
    ctx.offset = ctx.code.getOffset(prevLine, prevCol);
    
    if (ctx.event?.shiftKey) {
        if (!ctx.selection) {
            // Initialize selection with original offset as anchor
            ctx.selection = new Selection(originalOffset, ctx.offset);
        } else {
            ctx.selection = ctx.selection.fromCursor(ctx.offset);
        }
    } else {
        if (ctx.selection) {
            ctx.selection.reset(ctx.offset);
        }
    }

    return { ctx, changed: false };
};

export const moveArrowRight = (ctx: ActionContext, alt: boolean): ActionResult => {
    if (ctx.offset >= ctx.code.length()) return { ctx, changed: false };

    const originalOffset = ctx.offset;

    if (alt) {
        const { line, column } = ctx.code.getPosition(ctx.offset);
        const lineTextAll = ctx.code.line(line);
        const s = lineTextAll.slice(column);
        const match = s.match(/^[ \t]*\w+/);
        const jump = match ? match[0].length : 1;
        // advance by grapheme clusters equal to jump
        const lineText = lineTextAll;
        let col = column;
        for (let i = 0; i < jump; i++) {
            const nextCol = getNextGraphemeIndex(lineText, col);
            if (nextCol === col) { col++; } else { col = nextCol; }
        }
        if (col >= lineText.length) {
            // At end of line, jump to next line start if exists
            if (line + 1 < ctx.code.linesLength()) {
                ctx.offset = ctx.code.getOffset(line + 1, 0);
            } else {
                ctx.offset = ctx.code.getOffset(line, lineText.length);
            }
        } else {
            const newOffset = ctx.code.getOffset(line, col);
            ctx.offset = newOffset;
        }
    } else {
        if (ctx.selection && !ctx.selection.isEmpty() && !ctx.event?.shiftKey) {
            ctx.offset = ctx.selection.end;
        } else {
            const { line, column } = ctx.code.getPosition(ctx.offset);
            const lineText = ctx.code.line(line);
            if (column >= lineText.length) {
                // at end of line -> go to start of next line if available
                if (line + 1 < ctx.code.linesLength()) {
                    ctx.offset = ctx.code.getOffset(line + 1, 0);
                } else {
                    // already at end of buffer
                    return { ctx, changed: false };
                }
            } else {
                const nextCol = getNextGraphemeIndex(lineText, column);
                ctx.offset = ctx.code.getOffset(line, nextCol);
            }
        }
    }
    
    if (ctx.event?.shiftKey) {
        if (!ctx.selection) {
            // Initialize selection with original offset as anchor
            ctx.selection = new Selection(originalOffset, ctx.offset);
        } else {
            ctx.selection = ctx.selection.fromCursor(ctx.offset);
        }
    } else {
        if (ctx.selection) {
            ctx.selection = undefined;
        }
    }

    return { ctx, changed: false };
};

export const moveArrowLeft = (ctx: ActionContext, alt: boolean): ActionResult => {
    if (ctx.offset <= 0) return { ctx, changed: false };

    const originalOffset = ctx.offset;
    if (alt) {
        const { line, column } = ctx.code.getPosition(ctx.offset);
        const s = ctx.code.line(line).slice(0, column);
        const match = s.match(/\w+[ \t]*$/);
        const jump = match ? match[0].length : 1;
        // move left by grapheme clusters equal to jump
        const lineText = ctx.code.line(line);
        let col = column;
        for (let i = 0; i < jump; i++) {
            const prevCol = getPrevGraphemeIndex(lineText, col);
            if (prevCol === col) { col--; } else { col = prevCol; }
            if (col <= 0) { col = 0; break; }
        }
        const newOffset = ctx.code.getOffset(line, col);
        ctx.offset = newOffset;
    } else {
        if (ctx.selection && !ctx.selection.isEmpty() && !ctx.event?.shiftKey) {
            ctx.offset = ctx.selection.start;
        } else {
            const { line, column } = ctx.code.getPosition(ctx.offset);
            if (column === 0 && line > 0) {
                // move to end of previous line
                const prevLineLen = ctx.code.line(line - 1).length;
                ctx.offset = ctx.code.getOffset(line - 1, prevLineLen);
            } else {
                const lineText = ctx.code.line(line);
                const prevCol = getPrevGraphemeIndex(lineText, column);
                ctx.offset = ctx.code.getOffset(line, prevCol);
            }
        }
    }
    
    if (ctx.event?.shiftKey) {
        if (!ctx.selection) {
            // Initialize selection with original offset as anchor
            ctx.selection = new Selection(originalOffset, ctx.offset);
        } else {
            ctx.selection = ctx.selection.fromCursor(ctx.offset);
        }
    } else {
        if (ctx.selection) {
            ctx.selection = undefined;
        }
    }

    return { ctx, changed: false };
};

export const handleEsc = (ctx: ActionContext): ActionResult => {
    if (!ctx.selection?.isEmpty()) {
        ctx.selection = undefined;
        return { ctx, changed: true };
    }

    return { ctx, changed: false };
}