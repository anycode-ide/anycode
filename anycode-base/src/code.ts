import {
    PieceTreeBase,
    PieceTreeTextBufferBuilder
} from 'vscode-textbuffer';

import {
    Range
} from 'vscode-textbuffer/src/common/range';

import Parser from 'web-tree-sitter';

import javascript from './langs/javascript';
import typescript from './langs/typescript';
import python from './langs/python';
import rust from './langs/rust';
import yaml from './langs/yaml';
import json from './langs/json';
import toml from './langs/toml';
import html from './langs/html';
import css from './langs/css';
import go from './langs/go';
import java from './langs/java';
import kotlin from './langs/kotlin';
import lua from './langs/lua';
import bash from './langs/bash';
import zig from './langs/zig';
import csharp from './langs/csharp';
import c from './langs/c';
import cpp from './langs/cpp';

export enum Operation {
    Insert = 0,
    Remove = 1
}

export type Edit = {
    operation: Operation;
    start: number;
    text: string;
};

export type Transaction = {
    edits: Edit[];
};

export type Position = {
    line: number;
    column: number;
}

interface Indent {
    width: number,
    unit: string
}

interface Lang {
    query: string
    indent: Indent
    comment: string
    runnablesQuery?: string
    executable?: boolean
    cmd?: string
    cmdTest?: string
}

export interface HighlighedNode {
    name: string | null;
    text: string;
}

export interface Patch {
    start: number;
    search: string;
    replace: string;
}

var langsCache: Map<string, Parser.Language> = new Map();

export class Code {
    public filename: string
    private buffer: PieceTreeBase
    public language: string | undefined
    private parser: Parser | undefined
    private tree: Parser.Tree | undefined
    private query: Parser.Query | undefined
    private runnablesQuery: Parser.Query | undefined

    public runnables: Map<number, any> = new Map()

    private linesCache: Map<number, HighlighedNode[]> = new Map()

    public undoStack: Transaction[] = []
    public redoStack: Transaction[] = []
    private transactionActive: boolean = false;
    private transactionEdits: Edit[] = [];

    private onEdit: ((e: Edit) => void) | null = null

    private injection_parsers: Map<string, Parser> = new Map()
    private injection_queries: Map<string, Parser.Query> = new Map()
    private injectionCache = new Map<string, {
        startIndex: number;
        endIndex: number;
        name: string;
    }[]>();

    constructor(content: string = '', filename: string = '', language: string = 'text') {
        const builder = new PieceTreeTextBufferBuilder();
        builder.acceptChunk(content);
        const pieceTree = builder.finish(true).create(1);
        this.buffer = pieceTree;
        this.language = language;
        this.filename = filename;
        this.input = this.input.bind(this);
        this.getNodes = this.getNodes.bind(this);
    }

    public async init() {
        if (!this.language) {
            this.language = undefined;
            this.parser = undefined;
            this.tree = undefined;
            this.query = undefined;
            this.runnablesQuery = undefined;
            return;
        }

        await Parser.init();
        this.parser = new Parser();
        const filename = `tree-sitter-${this.language}.wasm`;

        const lang = langsCache.has(this.language) ?
            langsCache.get(this.language)! :
            await Parser.Language.load(filename);

        langsCache.set(this.language, lang);
        this.parser.setLanguage(lang);

        this.tree = this.parser.parse(this.input) || undefined;

        if (this.language) {
            let q = this.getQuery();
            if (q) this.query = lang.query(q);
            if (this.query) await this.initInjections();
            let tq = this.getRunnablesQuery();
            if (tq) this.runnablesQuery = lang.query(tq);
            if (this.runnablesQuery || this.isExecutable()) this.updateRunnables();
        }
    }

    public async initInjections() {
        if (!this.query) return;

        for (const name of this.query.captureNames) {
            if (name.startsWith("injection.content.")) {
                const language = name.slice("injection.content.".length);

                if (this.injection_parsers.has(language) 
                    && this.injection_queries.has(language)) {
                    continue;
                }

                let parser = new Parser();

                let lang;
                if (langsCache.has(language)) {
                    lang = langsCache.get(language)!;
                } else {
                    lang = await Parser.Language.load(`tree-sitter-${language}.wasm`);
                    langsCache.set(language, lang);
                }

                parser.setLanguage(lang);
                this.injection_parsers.set(language, parser);

                try {
                    const l = this.getLang(language);
                    let query = l?.query;
                    if (query) {
                        this.injection_queries.set(language, lang.query(query));
                    } else {
                        console.error(`No query available for ${language}`);
                    }
                } catch (e) {
                    console.error(e);
                }

                console.log('injection language initialized', name);
            }
        }
    }

    private buildInjectionCaptures(captures: any[]) {
        const injectionCaptures: Array<{
            startIndex: number;
            endIndex: number;
            name: string;
        }> = [];
    
        for (const capture of captures) {
            if (!capture.name.startsWith("injection.content.")) continue;
    
            const injectionLanguage = capture.name.slice("injection.content.".length);
            if (!this.injection_parsers.has(injectionLanguage) || 
                !this.injection_queries.has(injectionLanguage)) continue;
    
            // ---- cache key ----
            const key = `${injectionLanguage}:${capture.node.startIndex}-${capture.node.endIndex}`;
            if (this.injectionCache.has(key)) {
                injectionCaptures.push(...this.injectionCache.get(key)!);
                continue;
            }
    
            const injectionParser = this.injection_parsers.get(injectionLanguage)!;
            const injectionQuery = this.injection_queries.get(injectionLanguage)!;
            const injectionContent = this.getIntervalContent2(
                capture.node.startIndex, 
                capture.node.endIndex
            );
    
            const injectionTree = injectionParser.parse(injectionContent);
            const injectionTreeCaptures = injectionQuery.captures(injectionTree.rootNode);
    
            const results = injectionTreeCaptures.map(ic => ({
                startIndex: capture.node.startIndex + ic.node.startIndex,
                endIndex: capture.node.startIndex + ic.node.endIndex,
                name: ic.name
            }));
    
            // save to cache
            this.injectionCache.set(key, results);
            injectionCaptures.push(...results);
        }
        return injectionCaptures;
    }

    /**
      * Custom parser input function for tree-sitter
    */
    private input(startIndex: number, startPoint: any, endIndex?: number): string {
        let start = startIndex;
        let end = endIndex !== undefined ? endIndex : this.buffer.getLength();

        let startPosition = this.buffer.getPositionAt(start);
        let endPosition = this.buffer.getPositionAt(end);

        let value = this.buffer.getValueInRange(new Range(
            startPosition.lineNumber, startPosition.column,
            endPosition.lineNumber, endPosition.column
        ));

        return value;
    };

    public getContent(): string {
        return this.buffer.getLinesContent().join("\n")
    }

    public getIntervalContent(
        startLine: number, startColumn: number,
        endLine: number, endColumn: number
    ): string {
        let v = this.buffer.getValueInRange(
            new Range(startLine+1, startColumn+1, endLine + 1, endColumn+1)
        );
        return v;
    }

    public getIntervalContent2(from: number, to: number): string {
        let start = this.buffer.getPositionAt(from);
        let end = this.buffer.getPositionAt(to);

        let v = this.buffer.getValueInRange(
            new Range(
                start.lineNumber, start.column,
                end.lineNumber, end.column
            )
        );
        return v;
    }

    public setOnEdit(onEdit: (e: Edit) => void ) {
        this.onEdit = onEdit;
    }

    public getOffset(line: number, column: number): number {
        return this.buffer.getOffsetAt(line + 1, column + 1)
    }

    public getPosition(offset: number): Position {
        let p = this.buffer.getPositionAt(offset);
        return { line: p.lineNumber -1, column: p.column -1};
    }

    public getLineByOffset(offset: number): number {
        let p = this.buffer.getPositionAt(offset);
        return p.lineNumber - 1;
    }

    public length(): number {
        return this.buffer.getLength()
    }

    public linesLength(): number {
        return this.buffer.getLineCount()
    }

    public line(i: number): string {
        return this.buffer.getLineContent(i + 1)
    }

    public lineAt(offset: number): string {
        let position = this.getPosition(offset);
        return this.line(position.line)
    }

    public lineLength(i: number): number {
        return this.buffer.getLineLength(i + 1)
    }

    public insertText(text: string, line: number, column: number) {
        const offset = this.getOffset(line, column);
        this.insert(text, offset, true);
    }

    public setContent(content: string) {
        const pieceTreeTextBufferBuilder = new PieceTreeTextBufferBuilder();
        pieceTreeTextBufferBuilder.acceptChunk(content);
        const pieceTreeFactory = pieceTreeTextBufferBuilder.finish(true);
        const pieceTree = pieceTreeFactory.create(1);
        this.buffer = pieceTree;

        if (this.parser) this.tree = this.parser.parse(this.input) || undefined;
    }

    public insert(text: string, offset: number, addHistory: boolean = false) {
        let edit: Edit = {
            operation: Operation.Insert,
            start: offset,
            text
        };

        if (addHistory) {
            let transaction = { edits: [edit] } as Transaction;
            this.undoStack.push(transaction);
            this.redoStack = [];
        }

        if (this.transactionActive) {
            this.transactionEdits.push(edit);
        }

        this.buffer.insert(offset, text);
        if (this.tree) this.treeSitterInsert(text, offset);
        if (this.onEdit) this.onEdit(edit);

        this.linesCache.clear();
    }

    public removeText(
        fromLine: number, fromColumn: number,
        toLine: number, toColumn: number
    ) {
        const fromOffset = this.getOffset(fromLine, fromColumn);
        const toOffset = this.getOffset(toLine, toColumn);
        this.remove(fromOffset, toOffset - fromOffset, true);
    }

    public remove(offset: number, length: number, addHistory: boolean = false) {
        let start = this.buffer.getPositionAt(offset);
        let end = this.buffer.getPositionAt(offset + length);

        let text = this.buffer.getValueInRange(new Range(
            start.lineNumber, start.column, end.lineNumber, end.column
        ));

        let edit: Edit = {
            operation: Operation.Remove,
            start: offset,
            text
        };

        if (addHistory) {
            let transaction = { edits: [edit] } as Transaction;
            this.undoStack.push(transaction);
            this.redoStack = [];
        }

        if (this.transactionActive) {
            this.transactionEdits.push(edit);
        }

        this.buffer.delete(offset, length);
        if (this.tree) this.treeSitterRemove(offset + length, length);
        if (this.onEdit) this.onEdit(edit);

        this.linesCache.clear();
    }


    treeSitterInsert(text: string, offset: number) {
        let len = text.length;

        const startPosition = this.buffer.getPositionAt(offset);
        const oldEndPosition = startPosition;
        const newEndPosition = this.buffer.getPositionAt(offset + len);

        let edit = {
            startIndex: offset,
            oldEndIndex: offset,
            newEndIndex: offset + len,
            startPosition: { row: startPosition.lineNumber, column: startPosition.column },
            oldEndPosition: { row: oldEndPosition.lineNumber, column: oldEndPosition.column },
            newEndPosition: { row: newEndPosition.lineNumber, column: newEndPosition.column },
        };

        this.treeSitterApplyEdit(edit);
    }

    treeSitterRemove(offset: number, len: number) {
        const startPosition = this.buffer.getPositionAt(offset - len);
        const oldEndPosition = this.buffer.getPositionAt(offset);
        const newEndPosition = startPosition;

        let edit = {
            startIndex: offset - len,
            oldEndIndex: offset,
            newEndIndex: offset - len,
            startPosition: { row: startPosition.lineNumber, column: startPosition.column },
            oldEndPosition: { row: oldEndPosition.lineNumber, column: oldEndPosition.column },
            newEndPosition: { row: newEndPosition.lineNumber, column: newEndPosition.column },
        };

        this.treeSitterApplyEdit(edit);
    }

    treeSitterApplyEdit(edit: Parser.Edit) {
        this.tree!.edit(edit);
        let old = this.tree!;
        const newTree = this.parser!.parse(this.input, old);
        this.tree!.delete();
        this.tree = newTree || undefined;
    }

    public applyEdit(edit: Edit): void {
        const { operation, start, text } = edit;
        console.log('applyEdit', {edit})

        if (operation === Operation.Insert) {
            this.buffer.insert(start, text);
            if (this.tree) this.treeSitterInsert(text, start);
        } else if (operation === Operation.Remove) {
            this.buffer.delete(start, text.length);
            if (this.tree) this.treeSitterRemove(start + text.length, text.length);
        }

        this.linesCache.clear();

        if (this.onEdit) this.onEdit(edit);
    }

    public applyTransaction(transaction: Transaction, addHistory: boolean = false): void {
        const applied: Edit[] = [];

        try {
            for (const edit of transaction.edits) {
                const inverseEdit: Edit = {
                    operation: edit.operation === Operation.Insert ?
                        Operation.Remove : Operation.Insert,
                    start: edit.start,
                    text: edit.text
                };
                this.applyEdit(edit);
                applied.push(inverseEdit);
            }

            if (addHistory) {
                this.undoStack.push(transaction);
                this.redoStack = [];
            }

            this.linesCache.clear();
        } catch (err) {
            console.log('needs rollback', { applied });
            // Rollback in reverse order
            for (let i = applied.length - 1; i >= 0; i--) {
                const edit = applied[i];
                this.applyEdit(edit);
            }
            throw err;
        }
    }

    tx() {
        this.transactionActive = true;
        this.transactionEdits = [];
    }

    commit() {
        if (this.transactionActive) {
            let transaction = { edits: this.transactionEdits } as Transaction;
            this.undoStack.push(transaction);
            // this.redoStack = [];
            this.transactionActive = false;
            this.transactionEdits = [];
        } else {
            console.error('No active transaction to commit');
        }
    }

    public undo(): Transaction | undefined {
        if (this.undoStack.length === 0) return undefined;

        const transaction = this.undoStack.pop()!;
        transaction.edits.reverse();

        const inverseTransaction: Transaction = {
            edits: transaction.edits.map(edit => ({
                operation: edit.operation === Operation.Insert ?
                    Operation.Remove : Operation.Insert,
                start: edit.start,
                text: edit.text
            }))
        };

        try {
            this.applyTransaction(inverseTransaction, false);
            this.redoStack.push(transaction);
            return transaction;
        } catch (err) {
            console.error('Error during undo:', err);
            // If undo fails, push the transaction back onto the undo stack
            this.undoStack.push(transaction);
            throw err;
        }
    }

    public redo(): Transaction | null {
        if (this.redoStack.length === 0) return null;

        const transaction = this.redoStack.pop()!;
        if (transaction.edits.length > 0) transaction.edits.reverse();

        try {
            this.applyTransaction(transaction, false);
            this.undoStack.push(transaction);
            return transaction;
        } catch (err) {
            console.error('Error during redo:', err);
            // If redo fails, push the transaction back onto the redo stack
            this.redoStack.push(transaction);
            throw err;
        }
    }

    getLang(lang: string): Lang | null {
        if (lang === 'javascript') return javascript
        if (lang === 'typescript') return typescript
        if (lang === 'rust') return rust
        if (lang === 'python') return python
        if (lang === 'yaml') return yaml
        if (lang === 'json') return json
        if (lang === 'toml') return toml
        if (lang === 'html') return html
        if (lang === 'css') return css
        if (lang === 'go') return go
        if (lang === 'java') return java
        if (lang === 'kotlin') return kotlin
        if (lang === 'lua') return lua
        if (lang === 'bash') return bash
        if (lang === 'zig') return zig
        if (lang === 'csharp') return csharp
        if (lang === 'c') return c
        if (lang === 'cpp') return cpp
        return null
    }

    getQuery(): string | null {
        if (!this.language) return null;

        const language = this.getLang(this.language);
        return language?.query || null;
    }

    getRunnablesQuery(): string | null {
        if (!this.language) return null;

        const language = this.getLang(this.language);
        return language?.runnablesQuery || null;
    }

    getIndent(): Indent | null {
        if (!this.language) return null;

        const language = this.getLang(this.language!);
        return language?.indent || null;
    }

    getComment(): string {
        if (!this.language) return "";

        const language = this.getLang(this.language!);
        return language?.comment || "";
    }

    isExecutable(): boolean {
        if (!this.language) return false;
        const language = this.getLang(this.language!);
        return language?.executable || false;
    }

    public getNodes(startLine: number, endLine: number): HighlighedNode[][] {
        if (!endLine || endLine === -1) { endLine = this.linesLength() - 1; }

        // Handle case when no language, no parser, or no query is available
        if (!this.language || !this.tree || !this.query) {
            return new Array(endLine - startLine).fill(null).map((_, i) => {
                const lineText = this.buffer.getLineContent(startLine + i + 1) || "";
                return [{ name: null, text: lineText || "\u200B" }];
            });
        }

        let endColumn = this.lineLength(endLine);

        const startPoint = { row: startLine, column: 0 };
        const endPoint = { row: endLine + 1, column: endColumn };
        const captures = this.query.captures(this.tree.rootNode, startPoint, endPoint);

        const resultNodes: HighlighedNode[][] = [];

        for (let line = startLine; line < endLine; line++) {
            let bytesCounter = this.buffer.getOffsetAt(line + 1, 0 + 1);

            const lineText = this.buffer.getLineContent(line + 1) || "";
            const lineNodes: HighlighedNode[] = [];
            let lastCapture: HighlighedNode | null = null;

            let lineCaptures = captures.filter(capture =>
                capture.node.startPosition.row <= line && line <= capture.node.endPosition.row
            )

            for (let column = 0; column < lineText.length;) {
                let c = lineText[column];

                const capture = lineCaptures.find(capture =>
                    capture.node.startIndex <= bytesCounter && bytesCounter < capture.node.endIndex
                );

                if (capture) {
                    const captureStart = column;
                    const captureEnd = capture.node.endPosition.row !== line ?
                        lineText.length :
                        capture.node.endPosition.column

                    const text = lineText.substring(captureStart, captureEnd);
                    lastCapture = { name: capture.name, text };
                    lineNodes.push(lastCapture);

                    const textLength = text.length;
                    column += textLength;
                    bytesCounter += textLength;
                } else {
                    let text = c;

                    if (lastCapture && lastCapture.name === null) {
                        lastCapture.text += text;  // Append current character to the last text
                    } else {
                        lastCapture = { name: null, text }; // Create a new capture for the text
                        lineNodes.push(lastCapture);
                    }
                    column += text.length;
                    bytesCounter += text.length;
                }
            }

            if (lineNodes.length === 0) {
                lineNodes.push({ name: null, text: lineText || "\u200B" });
            }

            resultNodes.push(lineNodes);
            // bytesCounter += 1; // for '\n'
        }

        return resultNodes;
    }

    getLineNodes(line: number): HighlighedNode[] {
        if (this.linesCache.has(line)) {
            return this.linesCache.get(line)!;
        }
    
        const lineText = this.line(line) || "\u200B";
    
        if (!this.language || !this.tree || !this.query) {
            return [{ name: null, text: lineText }];
        }
    
        const captures = this.query.captures(
            this.tree.rootNode,
            { row: line, column: 0 },
            { row: line + 1, column: 0 }
        );
    
        const injectionCapturesArray = this.buildInjectionCaptures(captures);
    
        const lineNodes: HighlighedNode[] = [];
        let lastCapture: HighlighedNode | null = null;
    
        let bytesCounter = this.buffer.getOffsetAt(line + 1, 1);
    
        const appendNode = (name: string | null, text: string) => {
            if (lastCapture && lastCapture.name === name) {
                lastCapture.text += text;
            } else {
                lastCapture = { name, text };
                lineNodes.push(lastCapture);
            }
        };

        let column = 0;
        const advance = (len: number) => {
            column += len;
            bytesCounter += len;
        };
        
        for (; column < lineText.length;) {
            const capture = captures.find(
                c => c.node.startIndex <= bytesCounter && bytesCounter < c.node.endIndex
            );    
            if (capture?.name.startsWith("injection.content.")) {
                // --- CASE 1: Injection ---
                const injectionData = injectionCapturesArray.find(
                    inj => bytesCounter >= inj.startIndex && bytesCounter < inj.endIndex
                );
    
                if (injectionData) {
                    const textLength = injectionData.endIndex - injectionData.startIndex;
                    const text = lineText.substring(column, column + textLength);
                    appendNode(injectionData.name, text);
                    advance(textLength);
                    continue;
                } else {
                    // --- CASE 3: Plain text ---
                    appendNode(null, lineText[column]);
                    advance(1);
                    continue;
                }
            }
            if (capture) {
                // --- CASE 2: Normal capture ---
                const captureEnd = capture.node.endPosition.row !== line
                    ? lineText.length
                    : capture.node.endPosition.column;
    
                const text = lineText.substring(column, captureEnd);
                appendNode(capture.name, text);
                advance(text.length);
            } else {
                // --- CASE 3: Plain text ---
                appendNode(null, lineText[column]);
                advance(1);
            }
        }
    
        if (lineNodes.length === 0) {
            lineNodes.push({ name: null, text: lineText || "\u200B" });
        }
    
        this.linesCache.set(line, lineNodes);
        return lineNodes;
    }

    private updateRunnables() {
        this.runnables.clear();

        if (this.isExecutable()) {
            this.runnables.set(0, { file: this.filename })
        }

        if (!this.language || !this.tree || !this.runnablesQuery) return;

        let captures = this.runnablesQuery.captures(this.tree.rootNode);
        for (let capture of captures){
            let line = capture.node.startPosition.row;

            let startPosition = this.buffer.getPositionAt(capture.node.startIndex);
            let endPosition = this.buffer.getPositionAt(capture.node.endIndex);

            let value = this.buffer.getValueInRange(new Range(
                startPosition.lineNumber, startPosition.column,
                endPosition.lineNumber, endPosition.column
            ));

            let runnable = this.runnables.get(line) || { file: this.filename };
            runnable[capture.name] = value;
            this.runnables.set(line, runnable)
        }
    }

    public hasRunnable(line: number): boolean {
        return this.runnables.has(line)
    }

    public getRunnable(line: number): string | null {
        let runnableValue = this.runnables.get(line);

        const language = this.getLang(this.language!);

        let template = language?.cmdTest || "";

        if (this.isExecutable() && line === 0)
            template = language?.cmd || "";

        let result = template.replace(/{(.*?)}/g, (_, key) => runnableValue[key] || `{${key}}`);
        return result
    }

    public getIndentationLevel(line: number): number {
        let indent = this.getIndent();
        if (!indent) return 0;

        let lineText = this.line(line);

        // loop over lineText and count indent
        let indentation = 0;
        for (let char of lineText) {
            if (char === ' ') indentation++;
            else if (char === '\t') indentation += indent.width;
            else break;
        }

        let width = indent.width || 2;
        return Math.ceil(indentation / width);
    }

    public isOnlyIndentationBefore(line: number, column: number): boolean {
        let lineText = this.line(line);

        let col = 0;
        for (let char of lineText) {
            if (col >= column) break;
            if (char !== ' ') return false;
            col++;
        }
        return true;
    }

    public search(pattern: string): { line: number; column: number }[] {
        if (pattern === "") return [];
        const matches: { line: number; column: number }[] = [];

        // Iterate over each line of the text buffer
        for (let lineIndex = 0; lineIndex < this.linesLength(); lineIndex++) {
            const lineText = this.line(lineIndex);
            let startIndex = 0;

            // Find all occurrences of the pattern in the line
            while ((startIndex = lineText.indexOf(pattern, startIndex)) !== -1) {
                matches.push({
                    line: lineIndex,
                    column: startIndex,
                });

                // Move to the next character to find subsequent matches
                startIndex += pattern.length;
            }
        }

        return matches;
    }

    public searchOnLine(lineIndex: number, columnIndex: number, pattern: string): number[] {
        if (pattern === "") return [];
        const columns: number[] = [];

        // Get the text of the specified line
        const lineText = this.line(lineIndex);
        let startIndex = 0;

        // Find all occurrences of the pattern in the line
        while ((startIndex = lineText.indexOf(pattern, startIndex)) !== -1) {
            if (startIndex >= columnIndex) break;
            columns.push(startIndex);
            startIndex += pattern.length;
        }

        return columns;
    }

    clone() {
        return new Code(this.getContent(), this.filename, this.language!);
    }
}
