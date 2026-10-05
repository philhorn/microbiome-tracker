import React, { useState, useEffect } from 'react';

const columnColors = ['#f0f9ff', '#f0fdf4', '#fefce8', '#fff1f2', '#f3e8ff', '#ecfeff', '#fdf4ff'];

export default function TrackerGrid({ groups, visibleGroupIds, gridData, setGridData, listItems, searchTerm, activeRole, impersonatingId, selectedWeek, apiFetch, token }) {
    const [collapsedCats, setCollapsedCats] = useState({});
    const [undoMemory, setUndoMemory] = useState({});
    const [colWidths, setColWidths] = useState(() => {
        const saved = localStorage.getItem('colWidths');
        return saved ? JSON.parse(saved) : {};
    });

    useEffect(() => { localStorage.setItem('colWidths', JSON.stringify(colWidths)); }, [colWidths]);

    const visibleGroups = groups.filter(g => visibleGroupIds.includes(g.id));

    const handleToggle = async (memberId, itemName) => {
        const isChecked = gridData[memberId]?.includes(itemName);
        setGridData(prev => ({ ...prev, [memberId]: isChecked ? (prev[memberId] || []).filter(i => i !== itemName) : [...(prev[memberId] || []), itemName] }));
        await apiFetch(`/api/toggle/${memberId}`, token, impersonatingId, { method: 'POST', body: JSON.stringify({ item: itemName, checked: !isChecked, weekId: selectedWeek }) });
    };

    const handleCheckAll = async (itemName, action, group) => {
        const ids = group.members.map(m => m.id);
        const next = { ...gridData };
        const memKey = `${group.id}-${itemName}`;
        let finalCheckState = true;

        if (action === 'all') {
            const currentlyChecked = ids.filter(id => (next[id] || []).includes(itemName));
            setUndoMemory(prev => ({ ...prev, [memKey]: currentlyChecked }));
            ids.forEach(id => { if (!next[id]) next[id] = []; if (!next[id].includes(itemName)) next[id].push(itemName); });
        } else if (action === 'revert') {
            const mem = undoMemory[memKey] || [];
            ids.forEach(id => { next[id] = mem.includes(id) ? [...(next[id]||[]).filter(i=>i!==itemName), itemName] : (next[id]||[]).filter(i=>i!==itemName); });
            setUndoMemory(prev => { const n={...prev}; delete n[memKey]; return n; });
            finalCheckState = 'revert'; 
        } else if (action === 'clear') {
            ids.forEach(id => { if (next[id]) next[id] = next[id].filter(i => i !== itemName); });
            setUndoMemory(prev => { const n={...prev}; delete n[memKey]; return n; });
            finalCheckState = false;
        }
        setGridData(next);

        if (finalCheckState === 'revert') {
            const mem = undoMemory[memKey] || [];
            await Promise.all(ids.map(id => apiFetch(`/api/toggle/${id}`, token, impersonatingId, { method: 'POST', body: JSON.stringify({ item: itemName, checked: mem.includes(id), weekId: selectedWeek }) })));
        } else {
            await Promise.all(ids.map(id => apiFetch(`/api/toggle/${id}`, token, impersonatingId, { method: 'POST', body: JSON.stringify({ item: itemName, checked: finalCheckState, weekId: selectedWeek }) })));
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
            {visibleGroups.map(group => {
                const groupItems = listItems.filter(i => (i.group_id === null || i.group_id === group.id) && i.name.toLowerCase().includes(searchTerm.toLowerCase()));
                if (groupItems.length === 0 && searchTerm) return null;

                const categorized = {};
                groupItems.forEach(i => {
                    if (!categorized[i.category]) categorized[i.category] = [];
                    categorized[i.category].push(i);
                });

                return (
                    <div key={group.id} style={{ maxHeight: '70vh', overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', background: 'white', WebkitOverflowScrolling: 'touch' }}>
                        <div style={{ background: '#f8fafc', padding: '10px 15px', borderBottom: '2px solid #cbd5e1', position: 'sticky', top: 0, zIndex: 50, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0, color: '#1e293b' }}>{group.name}</h3>
                            <span style={{ fontSize: '12px', background: '#e2e8f0', padding: '4px 8px', borderRadius: '12px', fontWeight: 'bold' }}>{group.members.length} Members</span>
                        </div>
                        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', textAlign: 'center' }}>
                            <thead>
                                <tr>
                                    <th className="food-col cell-pad top-left-corner" style={{ width: colWidths['food'] || 160, minWidth: 120, maxWidth: colWidths['food'] || 160, borderBottom: '2px solid #cbd5e1', borderRight: '2px solid #cbd5e1', textAlign: 'left', top: '44px' }}>
                                        Task / Item <div className="drag-handle" onMouseDown={(e) => handleDrag(e, 'food', 160)} />
                                    </th>
                                    {group.members.map((m, idx) => (
                                        <th key={m.id} className="person-col cell-pad" style={{ width: colWidths[m.id] || 90, minWidth: 80, maxWidth: colWidths[m.id] || 90, background: columnColors[idx % columnColors.length], borderBottom: '2px solid #cbd5e1', borderRight: '1px solid #e2e8f0', top: '44px' }}>
                                            <span style={{ fontWeight: 'bold' }}>{m.name}</span><br/>
                                            <span style={{ fontSize: '0.85em', fontWeight: 'normal', color: '#64748b' }}>Score: {gridData[m.id]?.length || 0}</span>
                                            <div className="drag-handle" onMouseDown={(e) => handleDrag(e, m.id, 90)} />
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {Object.keys(categorized).map(category => {
                                    const catKey = `${group.id}-${category}`;
                                    return (
                                    <React.Fragment key={catKey}>
                                        <tr>
                                            <td onClick={() => setCollapsedCats({...collapsedCats, [catKey]: !collapsedCats[catKey]})} className="food-col cell-pad category-row" style={{ background: '#e2e8f0', borderBottom: '2px solid #cbd5e1', borderRight: '2px solid #cbd5e1', textAlign: 'left', fontWeight: 'bold', cursor: 'pointer' }}>
                                                {collapsedCats[catKey] ? '▶' : '▼'} {category}
                                            </td>
                                            {group.members.map(m => (
                                                <td key={m.id} className="cell-pad category-row" style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1', borderRight: '1px solid #cbd5e1' }}></td>
                                            ))}
                                        </tr>
                                        {!collapsedCats[catKey] && categorized[category].map(item => {
                                            const checkedCount = group.members.filter(m => (gridData[m.id] || []).includes(item.name)).length;
                                            let allBtnText = "All", action = 'all', btnColor = '#cbd5e1', hoverTitle = "Check everyone in group";
                                            const memKey = `${group.id}-${item.name}`;

                                            if (group.members.length > 0 && checkedCount === group.members.length) {
                                                if (undoMemory[memKey]) { allBtnText = "Revert"; action = 'revert'; btnColor = '#fde047'; hoverTitle = "Undo 'All'"; } 
                                                else { allBtnText = "Clear"; action = 'clear'; btnColor = '#fca5a5'; hoverTitle = "Uncheck everyone"; }
                                            }

                                            return (
                                            <tr key={item.name}>
                                                <td className="food-col cell-pad" style={{ borderBottom: '1px solid #f1f5f9', borderRight: '2px solid #cbd5e1', textAlign: 'left', fontWeight: '500', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <span style={{ color: item.group_id === null ? '#1d4ed8' : 'inherit' }}>
                                                        {item.name} {item.group_id === null && <span style={{fontSize: '10px', background: '#dbeafe', padding: '2px 4px', borderRadius: '4px', marginLeft: '6px', fontWeight: 'bold'}}>Global</span>}
                                                    </span>
                                                    {(activeRole === 'parent' || activeRole === 'admin') && group.members.length > 0 && (
                                                        <button onClick={() => handleCheckAll(item.name, action, group)} title={hoverTitle} style={{ fontSize: '12px', padding: '4px 8px', background: btnColor, border: 'none', borderRadius: '4px', cursor: 'pointer', minWidth: '45px' }}>{allBtnText}</button>
                                                    )}
                                                </td>
                                                {group.members.map((m, idx) => (
                                                    <td key={m.id} className="cell-pad" onClick={() => handleToggle(m.id, item.name)} style={{ background: columnColors[idx % columnColors.length], borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #e2e8f0', cursor: 'pointer' }}>
                                                        <input type="checkbox" checked={gridData[m.id]?.includes(item.name) || false} readOnly style={{ width: '22px', height: '22px', pointerEvents: 'none' }} />
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
                );
            })}
        </div>
    );
}
