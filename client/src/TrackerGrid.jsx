import React, { useState, useEffect } from 'react';

const columnColors = ['#f0f9ff', '#f0fdf4', '#fefce8', '#fff1f2', '#f3e8ff', '#ecfeff', '#fdf4ff'];

export default function TrackerGrid({ displayedUsers, gridData, setGridData, categorizedFoods, activeRole, impersonatingId, selectedWeek, apiFetch, token }) {
    const [collapsedCats, setCollapsedCats] = useState({});
    const [undoMemory, setUndoMemory] = useState({});
    const [colWidths, setColWidths] = useState(() => {
        const saved = localStorage.getItem('colWidths');
        return saved ? JSON.parse(saved) : {};
    });

    useEffect(() => { localStorage.setItem('colWidths', JSON.stringify(colWidths)); }, [colWidths]);

    const handleToggle = async (memberId, item) => {
        const isChecked = gridData[memberId]?.includes(item);
        setGridData(prev => ({ ...prev, [memberId]: isChecked ? (prev[memberId] || []).filter(i => i !== item) : [...(prev[memberId] || []), item] }));
        await apiFetch(`/api/toggle/${memberId}`, token, impersonatingId, { method: 'POST', body: JSON.stringify({ item, checked: !isChecked, weekId: selectedWeek }) });
    };

    const handleCheckAll = async (item, action) => {
        const ids = displayedUsers.map(m => m.id);
        const next = { ...gridData };
        let finalCheckState = true;

        if (action === 'all') {
            const currentlyChecked = ids.filter(id => (next[id] || []).includes(item));
            setUndoMemory(prev => ({ ...prev, [item]: currentlyChecked }));
            ids.forEach(id => { if (!next[id]) next[id] = []; if (!next[id].includes(item)) next[id].push(item); });
        } else if (action === 'revert') {
            const mem = undoMemory[item] || [];
            ids.forEach(id => { next[id] = mem.includes(id) ? [...(next[id]||[]).filter(i=>i!==item), item] : (next[id]||[]).filter(i=>i!==item); });
            setUndoMemory(prev => { const n={...prev}; delete n[item]; return n; });
            finalCheckState = 'revert'; 
        } else if (action === 'clear') {
            ids.forEach(id => { if (next[id]) next[id] = next[id].filter(i => i !== item); });
            setUndoMemory(prev => { const n={...prev}; delete n[item]; return n; });
            finalCheckState = false;
        }
        setGridData(next);

        if (finalCheckState === 'revert') {
            const mem = undoMemory[item] || [];
            await Promise.all(ids.map(id => apiFetch(`/api/toggle/${id}`, token, impersonatingId, { method: 'POST', body: JSON.stringify({ item, checked: mem.includes(id), weekId: selectedWeek }) })));
        } else {
            await Promise.all(ids.map(id => apiFetch(`/api/toggle/${id}`, token, impersonatingId, { method: 'POST', body: JSON.stringify({ item, checked: finalCheckState, weekId: selectedWeek }) })));
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
        <div style={{ maxHeight: '70vh', overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', background: 'white', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', textAlign: 'center' }}>
                <thead>
                    <tr>
                        <th className="food-col cell-pad top-left-corner" style={{ width: colWidths['food'] || 160, minWidth: 120, maxWidth: colWidths['food'] || 160, borderBottom: '2px solid #cbd5e1', borderRight: '2px solid #cbd5e1', textAlign: 'left' }}>
                            Food Item <div className="drag-handle" onMouseDown={(e) => handleDrag(e, 'food', 160)} />
                        </th>
                        {displayedUsers.map((m, idx) => (
                            <th key={m.id} className="person-col cell-pad" style={{ width: colWidths[m.id] || 90, minWidth: 80, maxWidth: colWidths[m.id] || 90, background: columnColors[idx % columnColors.length], borderBottom: '2px solid #cbd5e1', borderRight: '1px solid #e2e8f0' }}>
                                <span style={{ fontWeight: 'bold' }}>{m.name}</span><br/>
                                <span style={{ fontSize: '0.85em', fontWeight: 'normal', color: '#64748b' }}>Score: {gridData[m.id]?.length || 0}</span>
                                <div className="drag-handle" onMouseDown={(e) => handleDrag(e, m.id, 90)} />
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {Object.keys(categorizedFoods).map(category => (
                        <React.Fragment key={category}>
                            <tr>
                                <td onClick={() => setCollapsedCats({...collapsedCats, [category]: !collapsedCats[category]})} className="food-col cell-pad category-row" style={{ background: '#e2e8f0', borderBottom: '2px solid #cbd5e1', borderRight: '2px solid #cbd5e1', textAlign: 'left', fontWeight: 'bold', cursor: 'pointer' }}>
                                    {collapsedCats[category] ? '▶' : '▼'} {category}
                                </td>
                                {displayedUsers.map(m => (
                                    <td key={m.id} className="cell-pad category-row" style={{ background: '#f1f5f9', color: '#94a3b8', fontSize: '0.85em', textAlign: 'center', borderBottom: '2px solid #cbd5e1', borderRight: '1px solid #cbd5e1' }}>{category}</td>
                                ))}
                            </tr>
                            {!collapsedCats[category] && categorizedFoods[category].map(food => {
                                const checkedCount = displayedUsers.filter(m => (gridData[m.id] || []).includes(food)).length;
                                let allBtnText = "All", action = 'all', btnColor = '#cbd5e1', hoverTitle = "Check everyone visible";
                                if (displayedUsers.length > 0 && checkedCount === displayedUsers.length) {
                                    if (undoMemory[food]) { allBtnText = "Revert"; action = 'revert'; btnColor = '#fde047'; hoverTitle = "Undo 'All'"; } 
                                    else { allBtnText = "Clear"; action = 'clear'; btnColor = '#fca5a5'; hoverTitle = "Uncheck everyone visible"; }
                                }
                                return (
                                <tr key={food}>
                                    <td className="food-col cell-pad" style={{ borderBottom: '1px solid #f1f5f9', borderRight: '2px solid #cbd5e1', textAlign: 'left', fontWeight: '500', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span>{food}</span>
                                        {(activeRole === 'parent' || activeRole === 'admin') && displayedUsers.length > 0 && (
                                            <button onClick={() => handleCheckAll(food, action)} title={hoverTitle} style={{ fontSize: '12px', padding: '4px 8px', background: btnColor, border: 'none', borderRadius: '4px', cursor: 'pointer', minWidth: '45px' }}>{allBtnText}</button>
                                        )}
                                    </td>
                                    {displayedUsers.map((m, idx) => (
                                        <td key={m.id} className="cell-pad" onClick={() => handleToggle(m.id, food)} style={{ background: columnColors[idx % columnColors.length], borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #e2e8f0', cursor: 'pointer' }}>
                                            <input type="checkbox" checked={gridData[m.id]?.includes(food) || false} readOnly style={{ width: '22px', height: '22px', pointerEvents: 'none' }} />
                                        </td>
                                    ))}
                                </tr>
                                )
                            })}
                        </React.Fragment>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
