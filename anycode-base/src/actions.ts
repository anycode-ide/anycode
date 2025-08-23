import type { Code } from "./code";
import { Selection } from "./selection";
import { getIndentation } from "./utils";

export enum Action {
    // Navigation
    ARROW_LEFT = 'ARROW_LEFT',
    ARROW_RIGHT = 'ARROW_RIGHT',
    ARROW_UP = 'ARROW_UP',
    ARROW_DOWN = 'ARROW_DOWN',
    ARROW_LEFT_ALT = 'ARROW_LEFT_ALT',
    ARROW_RIGHT_ALT = 'ARROW_RIGHT_ALT',

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
        case Action.COMMENT: return handleToggleComment(ctx);
        default:
            return { ctx, changed: false };
    }
};


export const handleTextInput = (ctx: ActionContext): ActionResult => {
    ctx.code.tx();
    
    if (ctx.selection && ctx.selection.nonEmpty()) {
        removeSelection(ctx);
    }
    
    let text = ctx.event!.key;
    ctx.code.insert(text, ctx.offset);
    ctx.offset += text.length;
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

    if (ctx.selection?.nonEmpty()) {
        removeSelection(ctx);
        ctx.code.commit();
        return { ctx, changed: true };
    }

    if (ctx.offset <= 0) {
        ctx.code.commit();
        return { ctx, changed: false };
    }

    ctx.code.remove(ctx.offset - 1, 1);
    ctx.offset -= 1;

    ctx.code.commit();
    return { ctx, changed: true };
};

/**
 * Handles enter key - inserts newline with proper indentation
 */
export const handleEnter = (ctx: ActionContext): ActionResult => {
    ctx.code.tx();

    if (ctx.selection && ctx.selection.nonEmpty()) {
        removeSelection(ctx);
    }

    const { line } = ctx.code.getPosition(ctx.offset);
    const currentLine = ctx.code.line(line);

    const indent = getIndentation(currentLine);
    const newlineWithIndent = '\n' + indent;

    ctx.code.insert(newlineWithIndent, ctx.offset);
    ctx.offset += newlineWithIndent.length;

    ctx.code.commit();
    ctx.selection = undefined;

    return { ctx, changed: true };
};


export const handleUndo = (ctx: ActionContext): ActionResult => {
    const transaction = ctx.code.undo();

    if (transaction) {
        for (const edit of transaction.edits) {
            if (edit.operation === 0) {
                ctx.offset = edit.start;
            } else if (edit.operation === 1) {
                ctx.offset = edit.start + edit.text.length;
            }
        }
        ctx.selection = undefined;
        return { ctx, changed: true };
    }

    return { ctx, changed: false };
};

export const handleRedo = (ctx: ActionContext): ActionResult => {
    const transaction = ctx.code.redo();

    if (transaction) {
        for (const edit of transaction.edits) {
            if (edit.operation === 0) {
                ctx.offset = edit.start + edit.text.length;
            } else if (edit.operation === 1) {
                ctx.offset = edit.start;
            }
        }
        ctx.selection = undefined;
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
        await navigator.clipboard.writeText(content);
        console.log('Copied:', content);
    } catch (err) {
        console.error('Failed to copy:', err);
    }

    return { ctx, changed: false };
};

export const handlePaste = async (ctx: ActionContext): Promise<ActionResult> => {
    try {
        const text = await navigator.clipboard.readText();
        if (!text) return { ctx, changed: false };

        let o = ctx.offset;

        ctx.code.tx();
        if (ctx.selection && ctx.selection.nonEmpty()) {
            const [start, end] = ctx.selection.sorted();
            ctx.code.remove(start, end - start);
            o = start;
            ctx.selection = undefined;
        }

        ctx.code.insert(text, o);
        ctx.code.commit();

        ctx.offset = o + text.length;
        return { ctx, changed: true };
    } catch (err) {
        console.error('Failed to paste:', err);
        return { ctx, changed: false };
    }
};

export const handleCut = async (ctx: ActionContext): Promise<ActionResult> => {
    if (!ctx.selection || ctx.selection.isEmpty()) {
        return { ctx, changed: false };
    }

    try {
        let [start, end] = ctx.selection.sorted();
        let len = ctx.code.length();
        if (end > len) end = len; // todo: fix end bug

        let content = ctx.code.getIntervalContent2(start, end);
        await navigator.clipboard.writeText(content);
        console.log('Cut:', content);

        ctx.code.tx();
        ctx.code.remove(start, end - start);
        ctx.code.commit();

        ctx.offset = start;
        ctx.selection = undefined;
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
    const text = indent?.unit === ' ' 
        ? ' '.repeat(indent.width) 
        : '\t';

    ctx.code.tx();
    linesToHandle.reverse();

    let cursor = -1;

    for (const line of linesToHandle) {
        const start = ctx.code.getOffset(line, 0);
        ctx.code.insert(text, start);
        if (cursor === -1) {
            cursor = ctx.offset + text.length;
        }
    }

    ctx.code.commit();

    if (cursor !== -1) ctx.offset = cursor;
    ctx.selection = undefined;

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
    const text = indent?.unit === ' ' ? ' '.repeat(indent.width) : '\t';

    ctx.code.tx();
    linesToHandle.reverse();

    let cursor = -1;

    for (const line of linesToHandle) {
        const tabMatches = ctx.code.searchOnLine(line, text.length, text);
        if (tabMatches.length > 0) {
            const c = tabMatches[0];
            const start = ctx.code.getOffset(line, c);
            ctx.code.remove(start, text.length);
            if (cursor === -1) {
                cursor = ctx.offset - text.length;
            }
        }
    }

    ctx.code.commit();

    if (cursor !== -1) ctx.offset = cursor;
    ctx.selection = undefined;

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
    linesToHandle.reverse();

    let cursor = -1;

    for (const line of linesToHandle) {
        const lineText = ctx.code.line(line);

        if (commentFound) {
            // remove comment
            const matches = ctx.code.searchOnLine(line, lineText.length, comment);
            if (matches.length > 0) {
                const c = matches[0];
                const start = ctx.code.getOffset(line, c);
                ctx.code.remove(start, comment.length);
                if (cursor === -1) cursor = ctx.offset - comment.length;
            }
        } else {
            // insert comment
            const start = ctx.code.getOffset(line, 0);
            ctx.code.insert(comment, start);
            if (cursor === -1) cursor = ctx.offset + comment.length;
        }
    }

    ctx.code.commit();

    if (cursor !== -1) ctx.offset = cursor;
    ctx.selection = undefined;

    return { ctx, changed: true };
};


// ===== NAVIGATION FUNCTIONS =====

export const moveArrowDown = (ctx: ActionContext): ActionResult => {
    if (ctx.offset < 0) return { ctx, changed: false };

    const { line, column } = ctx.code.getPosition(ctx.offset);
    if (line >= ctx.code.linesLength() - 1) return { ctx, changed: false };

    const nextLine = line + 1;
    const nextCol = Math.min(column, ctx.code.lineLength(nextLine));
    ctx.offset = ctx.code.getOffset(nextLine, nextCol);
    
    if(ctx.selection) {
        if (ctx.event?.shiftKey) {
            ctx.selection = ctx.selection.fromCursor(ctx.offset);
        } else {
            ctx.selection.reset(ctx.offset)
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
    ctx.offset = ctx.code.getOffset(prevLine, prevCol);
    
    if(ctx.selection) {
        if (ctx.event?.shiftKey) {
            ctx.selection = ctx.selection.fromCursor(ctx.offset);
        } else {
            ctx.selection.reset(ctx.offset)
        }
    }

    return { ctx, changed: false };
};

export const moveArrowRight = (ctx: ActionContext, alt: boolean): ActionResult => {
    if (ctx.offset >= ctx.code.length()) return { ctx, changed: false };

    if (alt) {
        const { line, column } = ctx.code.getPosition(ctx.offset);
        const s = ctx.code.line(line).slice(column);
        const match = s.match(/^[ \t]*\w+/);
        const jump = match ? match[0].length : 1;
        ctx.offset += jump;
    } else {
        ctx.offset += 1;
    }
    
    if(ctx.selection) {
        if (ctx.event?.shiftKey) {
            ctx.selection = ctx.selection.fromCursor(ctx.offset);
        } else {
            ctx.selection.reset(ctx.offset)
        }
    }

    return { ctx, changed: false };
};

export const moveArrowLeft = (ctx: ActionContext, alt: boolean): ActionResult => {
    if (ctx.offset <= 0) return { ctx, changed: false };

    if (alt) {
        const { line, column } = ctx.code.getPosition(ctx.offset);
        const s = ctx.code.line(line).slice(0, column);
        const match = s.match(/\w+[ \t]*$/);
        const jump = match ? match[0].length : 1;
        ctx.offset -= jump;
    } else {
        ctx.offset -= 1;
    }
    
    if(ctx.selection) {
        if (ctx.event?.shiftKey) {
            ctx.selection = ctx.selection.fromCursor(ctx.offset);
        } else {
            ctx.selection.reset(ctx.offset)
        }
    }

    return { ctx, changed: false };
};