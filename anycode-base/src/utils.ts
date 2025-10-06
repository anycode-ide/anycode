export interface AnycodeLine extends HTMLDivElement {
    lineNumber: number;
    offset: number;
    hash: string;
}

export type Pos = { row: number; col: number };

export function generateCssClasses(theme: any) {
    let css = '';
    for (let key in theme) {
        let color = theme[key];
        key = key.replaceAll(".", "\\.");
        css += `.${key} { color: ${color};}\n`;
    }
    return css;
}
    
export function addCssToDocument(css: string, id: string) {
    let styleElement = document.getElementById(id) as HTMLStyleElement | null;

    if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = id;
        document.head.appendChild(styleElement);
    }
    else {
        // console.log("already exists", id)
    }

    styleElement.textContent = css;
}


export function isCharacter(event: KeyboardEvent): boolean {
    if (event.metaKey || event.ctrlKey) return false;

    if ((event.keyCode >= 48 && event.keyCode <= 90) || // Alphanumeric keys
        (event.keyCode >= 96 && event.keyCode <= 111) || // Numpad keys
        (event.keyCode >= 186 && event.keyCode <= 192) || // Symbol keys on US keyboards
        (event.keyCode >= 219 && event.keyCode <= 222) ||
        event.keyCode === 32) return true;
    else return false;
}

const WORD_BREAK_CHARS = [
    ' ', '.', ',', '=', '+', '-', '[', '(', '{', ']', ')', '}',
    '"', ':', '&', '?', '!', ';', '\t', '/', '<', '>', '\n', '\'', '`'
];

export function findNextWord(line: string, from: number): number {
    // Handle edge cases
    if (!line || from < 0) return 0;
    if (from >= line.length) return line.length;
    
    // Find the next word boundary after the specified index
    for (let i = from; i < line.length; i++) {
        if (WORD_BREAK_CHARS.includes(line[i])) {
            return i;
        }
    }
    return line.length;
}

export function findPrevWord(line: string, from: number): number {
    // Handle shorter texts and edge cases
    if (!line) return 0;
    if (from <= 0) return 0;
    if (from > line.length) from = line.length;
    
    // Start from the character before the cursor, looking backwards
    for (let i = from - 1; i >= 0; i--) {
        const ch = line[i];
        if (WORD_BREAK_CHARS.includes(ch)) {
            return i + 1;
        }
    }
    return 0;
}

/**
 * Determine the range to replace for completion
 * @param line The line of text
 * @param column Current column position
 * @returns Object with start and end indices for replacement
 */
export function getCompletionRange(line: string, column: number): { start: number; end: number } {
    if (!line) return { start: 0, end: 0 };
    
    const lineLength = line.length;
    
    // Ensure column is within bounds
    column = Math.max(0, Math.min(column, lineLength));
    
    // If we're at the end of the line or only whitespace follows
    if (column >= lineLength || /^\s/.test(line.slice(column))) {
        const start = findPrevWord(line, column);
        return { start, end: column };
    }
    
    // In the middle of a word - replace the entire word
    const start = findPrevWord(line, column);
    const end = findNextWord(line, column);
    return { start, end };
}

export function findNodeAndOffset(lineDiv: AnycodeLine, targetOffset: number) {
    let currentOffset = targetOffset;
    for (let chunkNode of lineDiv.children) {
        if (!chunkNode.textContent) continue;
        const textLength = chunkNode.textContent.length;
        if (currentOffset <= textLength) {
            return {
                node: chunkNode.firstChild,
                offset: currentOffset
            };
        }
        currentOffset -= textLength;
    }
    return null;
}

// Grapheme cluster helpers
let _graphemeSegmenter: Intl.Segmenter | null = null;

function getSegmenter(): Intl.Segmenter | null {
    try {
        if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
            if (!_graphemeSegmenter) {
                _graphemeSegmenter = new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' });
            }
            return _graphemeSegmenter;
        }
    } catch {
        // ignore
    }
    return null;
}

export function getPrevGraphemeIndex(line: string, fromColumn: number): number {
    if (fromColumn <= 0) return 0;
    const seg = getSegmenter();
    if (seg) {
        const segments = (seg as any).segment(line);
        let prev = 0;
        for (const part of segments) {
            const idx: number = part.index;
            if (idx >= fromColumn) break;
            prev = idx;
        }
        return prev;
    }
    // Fallback: iterate code points (won't perfectly handle ZWJ sequences)
    let count = 0;
    let lastIndex = 0;
    for (const ch of line) {
        const len = ch.length; // code units of this code point/grapheme
        if (count + len >= fromColumn) break;
        count += len;
        lastIndex = count;
    }
    return lastIndex;
}

export function getNextGraphemeIndex(line: string, fromColumn: number): number {
    if (fromColumn >= line.length) return line.length;
    const seg = getSegmenter();
    if (seg) {
        const segments = (seg as any).segment(line);
        let next = line.length;
        let passed = false;
        for (const part of segments) {
            const idx: number = part.index;
            if (!passed) {
                if (idx === fromColumn) {
                    passed = true;
                } else if (idx > fromColumn) {
                    // we were in the middle of a cluster, go to this boundary
                    return idx;
                }
                continue;
            } else {
                next = idx;
                break;
            }
        }
        return next;
    }
    // Fallback: step by a single code point
    let count = 0;
    for (const ch of line) {
        const len = ch.length;
        if (count === fromColumn) return count + len;
        count += len;
        if (count > fromColumn) return count; // inside code point
    }
    return line.length;
}

export function minimize(str: string, maxLength:number = 100): string {
    const newlineIndex = str.indexOf('\n');
    let result = str;
    
    if (newlineIndex !== -1) {
        result = str.slice(0, newlineIndex) + '…';
    }
    
    if (result.length > maxLength) {
        result = result.slice(0, maxLength) + '…';
    }
    return result;
}

export function objectHash(obj: any) {
    // console.time("objectHash")
    let hash = 0;

    for (const item of obj) {
        const name = item.name || '';
        const text = item.text;

        for (let i = 0; i < name.length; i++) {
            const char = name.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash |= 0; // Convert to 32bit integer
        }

        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash |= 0; // Convert to 32bit integer
        }
    }
    // console.timeEnd("objectHash")
    return hash;
}

/**
 * Helper function to get indentation from a line
 */
/**
 * Returns the indentation (whitespace) before a given column in the line.
 * If column is not provided, returns indentation of the whole line.
 * @param line The line of text
 * @param column The column up to which to check for indentation (exclusive)
 */
export function getIndentation(line: string, column?: number): string {
    const end = typeof column === "number" ? Math.min(column, line.length) : line.length;
    let i = 0;
    while (i < end && (line[i] === ' ' || line[i] === '\t')) {
        i++;
    }
    return line.slice(0, i);
}

export function scoreMatches(src: string, matchStr: string): number {
    if (src === matchStr) return 10000;
    let score = 0;

    // If the match is at the beginning, we give it a high score.
    if (src.startsWith(matchStr)) {
        score += 1000;
    }

    // Each occurrence of matchStr in src adds a smaller score.
    score += (src.match(new RegExp(matchStr, "g")) || []).length * 10;

    // If match is close to the start of the string but not at the beginning, add some score.
    const initialIndex = src.indexOf(matchStr);
    if (initialIndex !== -1 && initialIndex > 0 && initialIndex < 5) {
        score += 500;
    }

    return score;
}
