import React from 'react';
import { Terminal } from '../types';
import './TerminalTabs.css';

interface TerminalTabsProps {
    terminals: Terminal[];
    terminalSelected: number;
    onSelectTerminal: (index: number) => void;
    onCloseTerminal: (index: number) => void;
    onAddTerminal: () => void;
}

const TerminalTabs: React.FC<TerminalTabsProps> = ({
    terminals,
    terminalSelected,
    onSelectTerminal,
    onCloseTerminal: onRemoveTerminal,
    onAddTerminal
}) => {
    return (
        <div className="terminal-tabs-vertical">
            {terminals.map((term, index) => (
                <div
                    key={term.id}
                    className={`terminal-tab-vertical ${index === terminalSelected ? 'active' : ''}`}
                    onClick={() => onSelectTerminal(index)}
                >
                    <span className="terminal-tab-name">{term.name}</span>
                    {
                        <button
                            className="terminal-tab-close"
                            onClick={(e) => {
                                e.stopPropagation();
                                onRemoveTerminal(index);
                            }}
                        >
                            ×
                        </button>
                    }
                </div>
            ))}
            <button className="terminal-tab-add-vertical" onClick={onAddTerminal}>
                +
            </button>
        </div>
    );
};

export default TerminalTabs;
