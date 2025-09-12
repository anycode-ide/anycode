import React from 'react';
import { TreeNode } from '../types';
import './TreeNodeComponent.css';

interface TreeNodeComponentProps {
    node: TreeNode;
    level?: number;
    onToggle: (nodeId: string) => void;
    onSelect: (nodeId: string) => void;
    onOpenFile: (path: string) => void;
    onLoadFolder: (nodeId: string, path: string) => void;
}

const getFileExtension = (fileName: string): string => {
    return fileName.split('.').pop()?.toLowerCase() || '';
};

export const TreeNodeComponent: React.FC<TreeNodeComponentProps> = ({ 
    node, 
    level = 0, 
    onToggle, 
    onSelect, 
    onOpenFile, 
    onLoadFolder 
}) => {
    const hasChildren = node.type === 'directory';
    const isExpanded = node.isExpanded;
    const isSelected = node.isSelected;
    const fileExt = getFileExtension(node.name);

    const handleToggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (hasChildren) {
            onToggle(node.id);
        }
    };

    const handleSelect = () => {
        if (node.type === 'file') {
            onSelect(node.id);
            onOpenFile(node.path);
        } else if (node.type === 'directory') {
            if (!node.isExpanded) {
                onLoadFolder(node.id, node.path);
            } else {
                onToggle(node.id);
            }
        }
    };

    return (
        <div className="tree-item">
            <div 
                className={`tree-item-content ${node.type} ${isSelected ? 'selected' : ''}`}
                onClick={handleSelect}
            >
                <div className="tree-indent" style={{ width: level * 20 }}></div>
                
                <div 
                    className={`tree-toggle ${hasChildren ? (isExpanded ? 'expanded' : 'collapsed') : 'leaf'}`}
                    onClick={handleToggle}
                >
                    {hasChildren ? '▶' : ''}
                </div>
                
                <span className="tree-name" title={node.path + " " + node.size + " B"}>{node.name}</span>
            </div>
            
            {hasChildren && isExpanded && node.children && node.children.length > 0 && (
                <div className="tree-children">
                    {node.children.map(child => (
                        <TreeNodeComponent 
                            key={child.id} 
                            node={child} 
                            level={level + 1}
                            onToggle={onToggle}
                            onSelect={onSelect}
                            onOpenFile={onOpenFile}
                            onLoadFolder={onLoadFolder}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};
