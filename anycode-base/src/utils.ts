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
    // Find the next word index after the specified index
    for (let i = from; i < line.length; i++) {
        if (WORD_BREAK_CHARS.includes(line[i])) {
            return i;
        }
    }
    return line.length;
}
export function findPrevWord(line: string, from: number): number {
    // Find the previous word index before the specified index
    for (let i = from - 1; i >= 0; i--) {
        const ch = line[i];
        if (WORD_BREAK_CHARS.includes(ch)) {
            return i + 1;
        }
    }
    return 0;
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