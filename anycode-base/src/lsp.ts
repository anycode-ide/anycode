export interface Position {
    line: number;
    character: number;
}

export interface Range {
    start: Position;
    end: Position;
}

// === Completion ===
export interface Completion {
    label: string;
    kind?: number;
}

export interface CompletionRequest {
    file: string;
    row: number;
    column: number;
}

// === Hover ===
export interface HoverRequest {
    file: string;
    row: number;
    column: number;
}

export interface Hover {
    kind: string;
    value: string;
}

// === References ===
export interface ReferencesRequest {
    file: string;
    row: number;
    column: number;
}

export interface Reference {
    uri: string;
    file: string;
    range: Range;
}

// === Definition ===
export interface DefinitionRequest {
    file: string;
    row: number;
    column: number;
}

export interface DefinitionResponse {
    uri: string;
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
}

// === Diagnostics ===
export interface Diagnostic {
    range: Range;
    message: string;
}

export interface DiagnosticResponse {
    message: string;
    uri: string;
    diagnostics: Diagnostic[];
}

// === Completion Kind Map ===
export const completionKindMap: Record<number, string> = {
    1: "Text",
    2: "Method",
    3: "Function",
    4: "Constructor",
    5: "Field",
    6: "Variable",
    7: "Class",
    8: "Interface",
    9: "Module",
    10: "Property",
    11: "Unit",
    12: "Value",
    13: "Enum",
    14: "Keyword",
    15: "Snippet",
    16: "Color",
    17: "File",
    18: "Reference",
    19: "Folder",
    20: "EnumMember",
    21: "Constant",
    22: "Struct",
    23: "Event",
    24: "Operator",
    25: "TypeParameter",
};
