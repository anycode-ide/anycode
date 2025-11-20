import React, { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import "./TerminalComponent.css";
import '@xterm/xterm/css/xterm.css';

// Debounce utility function
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: number;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}


interface XTerminalProps {
    name: string;
    onData: (name: string, data: string) => void;
    onMessage: (name: string, callback: (data: string) => void) => (() => void);
    onResize: (name: string, cols: number, rows: number) => void;
    rows: number;
    cols: number;
    isConnected: boolean;
  }
  
  const TerminalComponent: React.FC<XTerminalProps> = ({
    name,
    onData,
    onMessage,
    onResize,
    rows,
    cols,
    isConnected,
  }) => {
    const terminalRef = useRef<HTMLDivElement | null>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);
    const serializeAddonRef = useRef<SerializeAddon | null>(null);
    const savedSnapshotRef = useRef<string>('');
    const mouseModeRef = useRef<boolean>(false);
    const fitAddonRef = useRef<FitAddon | null>(null);
  
    // Save latest snapshot across mounts
    const saveTerminalState = debounce(() => {
      if (serializeAddonRef.current) {
        const snapshot = serializeAddonRef.current.serialize();
        savedSnapshotRef.current = snapshot;
        localStorage.setItem('terminal:data:' + name, snapshot);
        localStorage.setItem('terminal:mouseMode:' + name, mouseModeRef.current.toString());
      }
    }, 200);
  
    const restoreTerminalState = (terminal: Terminal) => {
      const snapshot = savedSnapshotRef.current || 
        localStorage.getItem('terminal:data:' + name);
      // console.log('snapshot', snapshot);

      if (serializeAddonRef.current) {
        const currentState = serializeAddonRef.current.serialize();
        if (currentState === snapshot) { 
          // console.log("skip restore");
          return;
        }
      }
      if (snapshot) {
        terminal.reset();
        terminal.write(snapshot);
        if (fitAddonRef) {
          fitAddonRef.current?.fit();
        }
      }
      
      // Restore mouse mode state
      const savedMouseMode = localStorage.getItem('terminal:mouseMode:' + name);
      if (savedMouseMode === 'true') {
        mouseModeRef.current = true;
        console.log('Mouse mode need to be enabled');

        terminal.write('\x1b[?1000h'); // Enable mouse click events
        terminal.write('\x1b[?1002h'); // Enable mouse movement events
        terminal.write('\x1b[?1003h'); // Enable mouse movement events (with focus)
        terminal.write('\x1b[?1006h'); // Enable SGR mouse mode
    
      } 
    };
  
    // Save the incoming message handler globally
    const messageHandlerRef = useRef<((data: string) => void) | null>(null);
  
        // Store previous values to avoid unnecessary terminal recreation
    const prevRowsRef = useRef<number>(rows);
    const prevColsRef = useRef<number>(cols);

    useEffect(() => {
      let cleanup: (() => void) | undefined;

      if (!isConnected) {
        if (xtermRef.current) {
          xtermRef.current.dispose();
          xtermRef.current = null;
        }
        if (resizeObserverRef.current && terminalRef.current) {
          resizeObserverRef.current.disconnect();
          resizeObserverRef.current = null;
        }
        return;
      }

      // Only recreate terminal if rows/cols actually changed significantly
      const shouldRecreateTerminal = !xtermRef.current ||
        Math.abs(rows - prevRowsRef.current) > 1 ||
        Math.abs(cols - prevColsRef.current) > 1;

      if (shouldRecreateTerminal) {
        if (xtermRef.current) {
          xtermRef.current.dispose();
          xtermRef.current = null;
        }

        const terminal = new Terminal({
          cursorBlink: true,
          rows,
          cols,
          fontWeight: 'bold',
          scrollback: 10000,
          // Enable mouse support
          macOptionIsMeta: true,
          macOptionClickForcesSelection: true,
          rightClickSelectsWord: true,
          // Mouse settings
          allowTransparency: true,
        });

        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);

        const serializeAddon = new SerializeAddon();
        serializeAddonRef.current = serializeAddon;
        terminal.loadAddon(serializeAddon);

        if (terminalRef.current) {
          terminal.open(terminalRef.current);
        }
        xtermRef.current = terminal;

        terminal.options.theme = { background: 'transparent' };
        setTimeout(() => {
          fitAddon.fit();
        }, 1000);

        const resizeObserver = new ResizeObserver(() => {
          fitAddon.fit();
        });

        if (terminalRef.current) {
          resizeObserver.observe(terminalRef.current);
        }
        resizeObserverRef.current = resizeObserver;

        restoreTerminalState(terminal);

        const handler = (data: string) => {
          terminal.write(data);
          saveTerminalState();

          // Check if mouse mode is being enabled/disabled by programs
          // These escape sequences are sent by programs like vim, nano, htop to enable mouse mode
          if (data.includes('\x1b[?1000h') || data.includes('\x1b[?1002h') || data.includes('\x1b[?1003h') || data.includes('\x1b[?1006h')) {
            mouseModeRef.current = true;
            saveTerminalState();
            console.log('Mouse mode enabled by program');
          } else if (data.includes('\x1b[?1000l') || data.includes('\x1b[?1002l') || data.includes('\x1b[?1003l') || data.includes('\x1b[?1006l')) {
            mouseModeRef.current = false;
            saveTerminalState();
            console.log('Mouse mode disabled by program');
          }
        };
        messageHandlerRef.current = handler;
        cleanup = onMessage(name, handler);

        terminal.onData((data) => {
          onData(name, data);
          saveTerminalState();
        });

        terminal.onResize((size) => {
          onResize(name, size.cols, size.rows);
          saveTerminalState();
        });

        terminal.focus();

        // Update previous values
        prevRowsRef.current = rows;
        prevColsRef.current = cols;
      } else if (xtermRef.current) {
        // Just resize existing terminal if dimensions changed slightly
        xtermRef.current.resize(cols, rows);
        prevRowsRef.current = rows;
        prevColsRef.current = cols;
      }

      return () => {
        if (cleanup) {
          cleanup();
        }
        if (xtermRef.current) {
          xtermRef.current.dispose();
          xtermRef.current = null;
        }
        if (resizeObserverRef.current && terminalRef.current) {
          resizeObserverRef.current.disconnect();
          resizeObserverRef.current = null;
        }
      };
    }, [isConnected, name, rows, cols, onData, onMessage, onResize]);
  
    return (
      <div
        ref={terminalRef}
        style={{
          width: '100%',
          height: '100%',
          color: 'white',
          position: 'relative',
        }}
      >
        {!isConnected && (
          <div className="terminal-disconnected">
            Disconnected
          </div>
        )}
      </div>
    );
  };
export default React.memo(TerminalComponent);
