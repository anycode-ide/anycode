
import { type Terminal} from './types';

export function loadLeftPanelVisible(): boolean {
    const stored = localStorage.getItem('leftPanelVisible');
    if (stored) {
        return JSON.parse(stored);
    }
    return false;
}
export function loadTerminalVisible(): boolean {
    const stored = localStorage.getItem('terminalVisible');
    if (stored) {
        return JSON.parse(stored);
    }
    return false;
}

export function loadTerminals(): Terminal[] {
    const stored = localStorage.getItem('terminals');
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch (e) {
            console.error('Failed to parse terminals from localStorage', e);
        }
    }
    return [{ id: '0', name: 'terminal1', session: 'anycode', cols: 60, rows: 20 }];
};