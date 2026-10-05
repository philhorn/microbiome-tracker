import React, { useState, useEffect } from 'react';

const columnColors = ['#f0f9ff', '#f0fdf4', '#fefce8', '#fff1f2', '#f3e8ff', '#ecfeff', '#fdf4ff'];

export default function TrackerGrid({ groups, visibleGroupIds, gridData, setGridData, listItems, searchTerm, filterMode, sortMode, effectiveUserId, activeRole, impersonatingId, selectedWeek, apiFetch, token }) {
    const [collapsedCats, setCollapsedCats] = useState({});
    const [collapsedGroups, setCollapsedGroups] = useState({});
    const [undoMemory, setUndoMemory] = useState({});
    const [colWidths, setColWidths] = useState(() => {
        const saved = localStorage.getItem('colWidths');
        return saved ? JSON.parse(saved) : {};
    });

    useEffect(() => { localStorage.setItem('colWidths', JSON.stringify(colWidths)); }, [colWidths]);

    const visibleGroups = groups.filter(g => visibleGroupIds.includes(g.id));

    if (visibleGroups.length === 0) {
        return (
            <div style={{ padding: '40px 20px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', border: '2px dashed #cbd5e1', color: '#64748b' }}>
                <h3 style={{ margin: '0 0 10px 0' }}>No Workspace Selected</h3>
                <p style={{ margin: 0 }}>Click a group toggle button above to view its checklist.</p>
            </div>
        );
    }

    const handleToggle = async (memberId, itemName, groupId, isGlobalItem, isUnifiedGroup) => {
        const isChecked = (gridData[groupId]?.[memberId] || []).includes(itemName);
        
        setGridData(prev => {
            const next = JSON.parse(JSON.stringify(prev));
            const appliesToAll = isGlobalItem && isUnifiedGroup;
            
            Object.keys(next).forEach(gid => {
                const g = groups.find(x => x.id.toString() === gid.toString());
                if (appliesToAll && g && g.isolate_tracker === 0) {
                    if (next[gid] && next[gid][memberId]) {
                        if (!isChecked && !next[gid][memberId].includes(itemName)) next[gid][memberId].push(itemName);
                        else if (isChecked) next[gid][memberId] = next[gid][memberId].filter(i => i !== itemName);
                    }
                } else if (gid.toString() === groupId.toString()) {
                    if (next[gid] && next[gid][memberId]) {
                        if (!isChecked && !next[gid][memberId].includes(itemName)) next[gid][memberId].push(itemName);
                        else if (isChecked) next[gid][memberId] = next[gid][memberId].filter(i => i !== itemName);
                    }
                }
            });
            return next;
        });
        
        await apiFetch(`/api/toggle/${memberId}`, token, impersonatingId, { method: 'POST', body: JSON.stringify({ item: itemName, checked: !isChecked, weekId: selectedWeek, groupId }) });
    };

    const handleCheckAll = async (itemName, action, group, isGlobalItem) => {
        const ids = group.members.map(m => m.id);
        const next = JSON.parse(JSON.stringify(gridData));
        const memKey = `${group.id}-${itemName}`;
        let finalCheckState = true;
        const isUnifiedGroup = group.isolate_tracker === 0;
        const appliesToAll = isGlobalItem && isUnifiedGroup;

        if (action === 'all') {
            const currentlyChecked = ids.filter(id => (next[group.id]?.[id] || []).includes(itemName));
            setUndoMemory(prev => ({ ...prev, [memKey]: currentlyChecked }));
            
            ids.forEach(id => {
                Object.keys(next).forEach(gid => {
                    const g = groups.find(x => x.id.toString() === gid.toString());
                    if (appliesToAll && g && g.isolate_tracker === 0) {
                        if (next[gid] && next[gid][id] && !next[gid][id].includes(itemName)) next[gid][id].push(itemName);
                    } else if (gid.toString() === group.id.toString()) {
                        if (next[gid] && next[gid][id] && !next[gid][id].includes(itemName)) next[gid][id].push(itemName);
                    }
                });
            });
        } else if (action === 'revert') {
            const mem = undoMemory[memKey] || [];
            ids.forEach(id => {
                const shouldBeChecked = mem.includes(id);
                Object.keys(next).forEach(gid => {
                    const g = groups.find(x => x.id.toString() === gid.toString());
                    if (appliesToAll && g && g.isolate_tracker === 0) {
                        if (next[gid] && next[gid][id]) {
                            if (shouldBeChecked && !next[gid][id].includes(itemName)) next[gid][id].push(itemName);
                            else if (!shouldBeChecked) next[gid][id] = next[gid][id].filter(i=>i!==itemName);
                        }
                    } else if (gid.toString() === group.id.toString()) {
                        if (next[gid] && next[gid][id]) {
                            if (shouldBeChecked && !next[gid][id].includes(itemName)) next[gid][id].push(itemName);
                            else if (!shouldBeChecked) next[gid][id] = next[gid][id].filter(i=>i!==itemName);
                        }
                    }
                });
            });
            setUndoMemory(prev => { const n={...prev}; delete n[memKey]; return n; });
            finalCheckState = 'revert'; 
        } else if (action === 'clear') {
            ids.forEach(id => {
                Object.keys(next).forEach(gid => {
                    const g = groups.find(x => x.id.toString() === gid.toString());
                    if (appliesToAll && g && g.isolate_tracker === 0) {
                        if (next[gid] && next[gid][id]) next[gid][id] = next[gid][id].filter(i=>i!==itemName);
                    } else if (gid.toString() === group.id.toString()) {
                        if (next[gid] && next[gid][id]) next[gid][id] = next[gid][id].filter(i=>i!==itemName);
                    }
                });
            });
            setUndoMemory(prev => { const n={...prev}; delete n[memKey]; return n; });
            finalCheckState = false;
        }
        setGridData(next);

        if (finalCheckState === 'revert') {
            const mem = undoMemory[memKey] || [];
            await Promise.all(ids.map(id => apiFetch(`/api/toggle/${id}`, token, impersonatingId, { method: 'POST', body: JSON.stringify({ item: itemName, checked: mem.includes(id), weekId: selectedWeek, groupId: group.id }) })));
        } else {
            await Promise.all(ids.map(id => apiFetch(`/api/toggle/${id}`, token, impersonatingId, { method: 'POST', body: JSON.stringify({ item: itemName, checked: finalCheckState, weekId: selectedWeek, groupId: group.id }) })));
        }
    };

    const handleDrag = (e, colId, defaultWidth) => {
        const startX = e.clientX;
        const startWidth = colWidths[colId] || defaultWidth;
        const onMouseMove = (moveEvent) => {
            const newWidth = Math.max(80, startWidth + (moveEvent.clientX - startX));
            setColWidths(prev => ({ ...prev, [colId]: newWidth }));
        };
        const onMouseUp = () => { document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <style>{`
                .tracker-table-container {
                    overflow-x: auto;
                    overflow-y: visible;
                    border: 1px solid #cbd5e1;
                    border-top: none;
                    border-bottom-left-radius: 8px;
                    border-bottom-right-radius: 8px;
                    background: white;
                    -webkit-overflow-scrolling: touch;
                }
                .tracker-table {
                    border-collapse: separate;
                    border-spacing: 0;
                    width: 100%;
                    text-align: center;
                }
                .tracker-table th.person-col {
                    position: sticky;
                    top: 0;
                    z-index: 30;
                }
                .tracker-table th.food-col-header {
                    position: sticky;
                    top: 0;
                    left: 0;
                    z-index: 40;
                    background: #f1f5f9;
                }
                .tracker-table td.food-col-cell {
                    position: sticky;
                    left: 0;
                    z-index: 20;
                    background: white;
                }
                .tracker-table td.cat-col-cell {
                    position: sticky;
                    left: 0;
                    z-index: 20;
                    background: #cbd5e1;
                }
            `}</style>

            {visibleGroups.map(group => {
                let groupItems = listItems.filter(i => (i.group_id === null || i.group_id === group.id) && i.name.toLowerCase().includes(searchTerm.toLowerCase()));
                
                if (filterMode === 'CHECKED') {
                    groupItems = groupItems.filter(i => (gridData[group.id]?.[effectiveUserId] || []).includes(i.name));
                } else if (filterMode === 'UNCHECKED') {
                    groupItems = groupItems.filter(i => !(gridData[group.id]?.[effectiveUserId] || []).includes(i.name));
                }

                if (groupItems.length === 0 && (searchTerm || filterMode !== 'ALL')) return null;

                const categorized = {};
                groupItems.forEach(i => {
                    if (!categorized[i.category]) categorized[i.category] = [];
                    categorized[i.category].push(i);
                });
                
                const sortedCats = Object.keys(categorized).sort();
                const isGroupCollapsed = collapsedGroups[group.id];

                return (
                    <div key={group.id} style={{ border: '1px solid #cbd5e1', borderRadius: '8px', background: 'white', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
                        <div onClick={() => setCollapsedGroups({...collapsedGroups, [group.id]: !isGroupCollapsed})} style={{ background: group.theme_color || '#1e293b', color: 'white', padding: '14px 15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none', transition: 'background 0.3s ease' }}>
                            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px', fontSize: '16px' }}>
                                {group.logo_url && <img src={group.logo_url} alt="Logo" style={{ height: '24px', borderRadius: '4px', background: 'white', padding: '2px' }} />}
                                <span>{isGroupCollapsed ? '▶' : '▼'}</span> {group.name} {group.app_name ? `(${group.app_name})` : ''}
                            </h3>
                            <span style={{ fontSize: '12px', background: 'rgba(0,0,0,0.2)', padding: '4px 10px', borderRadius: '12px', fontWeight: 'bold' }}>{group.members.length} Members</span>
                        </div>
                        
                        {!isGroupCollapsed && (
                            <div className="tracker-table-container">
                                <table className="tracker-table">
                                    <thead>
                                        <tr>
                                            <th className="food-col-header cell-pad" style={{ width: colWidths['food'] || 160, minWidth: 120, maxWidth: colWidths['food'] || 160, borderBottom: '2px solid #94a3b8', borderRight: '2px solid #94a3b8', textAlign: 'left' }}>
                                                Task / Item <div className="drag-handle" onMouseDown={(e) => handleDrag(e, 'food', 160)} />
                                            </th>
                                            {group.members.map((m, idx) => (
                                                <th key={m.id} className="person-col cell-pad" style={{ width: colWidths[m.id] || 90, minWidth: 80, maxWidth: colWidths[m.id] || 90, background: columnColors[idx % columnColors.length], borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e2e8f0' }}>
                                                    <span style={{ fontWeight: 'bold' }}>{m.name}</span><br/>
                                                    <span style={{ fontSize: '0.85em', fontWeight: 'normal', color: '#64748b' }}>Score: {gridData[group.id]?.[m.id]?.length || 0}</span>
                                                    <div className="drag-handle" onMouseDown={(e) => handleDrag(e, m.id, 90)} />
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortedCats.map(category => {
                                            const catKey = `${group.id}-${category}`;
                                            
                                            const sortedItems = categorized[category].sort((a, b) => {
                                                const aChecked = (gridData[group.id]?.[effectiveUserId] || []).includes(a.name);
                                                const bChecked = (gridData[group.id]?.[effectiveUserId] || []).includes(b.name);
                                                
                                                if (sortMode === 'CHECKED_FIRST') {
                                                    if (aChecked && !bChecked) return -1;
                                                    if (!aChecked && bChecked) return 1;
                                                } else if (sortMode === 'UNCHECKED_FIRST') {
                                                    if (!aChecked && bChecked) return -1;
                                                    if (aChecked && !bChecked) return 1;
                                                }
                                                return a.name.localeCompare(b.name);
                                            });

                                            return (
                                            <React.Fragment key={catKey}>
                                                <tr>
                                                    <td onClick={() => setCollapsedCats({...collapsedCats, [catKey]: !collapsedCats[catKey]})} className="cat-col-cell cell-pad" style={{ borderBottom: '2px solid #94a3b8', borderRight: '2px solid #94a3b8', textAlign: 'left', fontWeight: 'bold', cursor: 'pointer', color: '#0f172a', fontSize: '14px' }}>
                                                        {collapsedCats[catKey] ? '▶' : '▼'} {category}
                                                    </td>
                                                    {group.members.map(m => (
                                                        <td key={m.id} className="cell-pad" style={{ background: '#e2e8f0', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #c5cffd' }}></td>
                                                    ))}
                                                </tr>
                                                {!collapsedCats[catKey] && sortedItems.map(item => {
                                                    const checkedCount = group.members.filter(m => (gridData[group.id]?.[m.id] || []).includes(item.name)).length;
                                                    let allBtnText = "All", action = 'all', btnColor = '#cbd5e1', hoverTitle = "Check everyone in group";
                                                    const memKey = `${group.id}-${item.name}`;

                                                    if (group.members.length > 0 && checkedCount === group.members.length) {
                                                        if (undoMemory[memKey]) { allBtnText = "Revert"; action = 'revert'; btnColor = '#fde047'; hoverTitle = "Undo 'All'"; } 
                                                        else { allBtnText = "Clear"; action = 'clear'; btnColor = '#fca5a5'; hoverTitle = "Uncheck everyone"; }
                                                    }
                                                    
                                                    const isGlobal = item.group_id === null;
                                                    const isUnified = group.isolate_tracker === 0;

                                                    return (
                                                    <tr key={item.name}>
                                                        <td className="food-col-cell cell-pad" style={{ borderBottom: '1px solid #f1f5f9', borderRight: '2px solid #cbd5e1', textAlign: 'left', fontWeight: '500', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <span style={{ color: isGlobal ? '#1d4ed8' : 'inherit' }}>
                                                                {item.name} {isGlobal && <span style={{fontSize: '10px', background: '#dbeafe', padding: '2px 4px', borderRadius: '4px', marginLeft: '6px', fontWeight: 'bold'}}>Global</span>}
                                                            </span>
                                                            {(activeRole === 'parent' || activeRole === 'admin') && group.members.length > 0 && (
                                                                <button onClick={() => handleCheckAll(item.name, action, group, isGlobal)} title={hoverTitle} style={{ fontSize: '12px', padding: '4px 8px', background: btnColor, border: 'none', borderRadius: '4px', cursor: 'pointer', minWidth: '45px' }}>{allBtnText}</button>
                                                            )}
                                                        </td>
                                                        {group.members.map((m, idx) => (
                                                            <td key={m.id} className="cell-pad" onClick={() => handleToggle(m.id, item.name, group.id, isGlobal, isUnified)} style={{ background: columnColors[idx % columnColors.length], borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #e2e8f0', cursor: 'pointer' }}>
                                                                <input type="checkbox" checked={(gridData[group.id]?.[m.id] || []).includes(item.name)} readOnly style={{ width: '22px', height: '22px', pointerEvents: 'none' }} />
                                                            </td>
                                                        ))}
                                                    </tr>
                                                    )
                                                })}
                                            </React.Fragment>
                                        )})}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
