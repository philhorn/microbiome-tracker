import React, { useState } from 'react';

export default function ListManager({ listItems, groups, activeRole, token, impersonatingId, apiFetch, refreshTrigger }) {
    
    // Default to the first group they belong to, or GLOBAL if admin
    const defaultGroup = activeRole === 'admin' ? "GLOBAL" : (groups.length > 0 ? groups[0].id.toString() : "");
    const [selectedGroupId, setSelectedGroupId] = useState(defaultGroup);
    
    const [newFoodName, setNewFoodName] = useState('');
    const [newFoodCat, setNewFoodCat] = useState('');
    const [customCat, setCustomCat] = useState('');
    const [editingFood, setEditingFood] = useState(null);

    // Filter items based on the active selection
    const displayItems = listItems.filter(i => selectedGroupId === "GLOBAL" ? i.group_id === null : i.group_id === parseInt(selectedGroupId));
    
    // Extract unique categories for the dropdown from ALL visible items to make selection easier
    const categories = [...new Set(listItems.map(i => i.category))];
    
    // Group display items for rendering
    const categorized = {};
    displayItems.forEach(i => {
        if (!categorized[i.category]) categorized[i.category] = [];
        categorized[i.category].push(i);
    });

    const handleAdd = async (e) => {
        e.preventDefault();
        const cat = newFoodCat === 'NEW' ? customCat : newFoodCat;
        if (!cat || !newFoodName) return alert('Name and Category required');
        
        const payload = { 
            action: 'add', 
            name: newFoodName, 
            category: cat,
            group_id: selectedGroupId === "GLOBAL" ? null : parseInt(selectedGroupId)
        };
        
        const res = await apiFetch('/api/lists/manage', token, impersonatingId, { method: 'POST', body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.success) {
            setNewFoodName(''); setCustomCat(''); setNewFoodCat('');
            refreshTrigger(); alert('Item added!');
        } else alert(data.error);
    };

    const handleEditSave = async () => {
        if (!editingFood.name || !editingFood.category) return;
        
        const payload = { 
            action: 'edit', 
            oldName: editingFood.oldName, 
            name: editingFood.name, 
            category: editingFood.category,
            group_id: selectedGroupId === "GLOBAL" ? null : parseInt(selectedGroupId)
        };
        
        const res = await apiFetch('/api/lists/manage', token, impersonatingId, { method: 'POST', body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.success) { setEditingFood(null); refreshTrigger(); } else alert(data.error);
    };

    const handleDelete = async (name) => {
        if (!window.confirm(`Delete "${name}"? This will permanently wipe this item from the tracker.`)) return;
        
        const payload = { 
            action: 'delete', 
            name,
            group_id: selectedGroupId === "GLOBAL" ? null : parseInt(selectedGroupId)
        };
        
        const res = await apiFetch('/api/lists/manage', token, impersonatingId, { method: 'POST', body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.success) refreshTrigger(); else alert(data.error);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '800px' }}>
            
            <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '15px' }}>
                <strong style={{ fontSize: '16px' }}>Select Checklist to Manage:</strong>
                <select value={selectedGroupId} onChange={e => setSelectedGroupId(e.target.value)} className="form-input" style={{ maxWidth: '300px', fontWeight: 'bold' }}>
                    {activeRole === 'admin' && <option value="GLOBAL">Global System List (All Groups)</option>}
                    {groups.map(g => <option key={g.id} value={g.id.toString()}>{g.name} Custom List</option>)}
                </select>
            </div>

            <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <h3 style={{ marginTop: 0 }}>Add New Item</h3>
                <form onSubmit={handleAdd} style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexGrow: 1 }}>
                        <strong>Task / Item Name:</strong>
                        <input type="text" value={newFoodName} onChange={e => setNewFoodName(e.target.value)} required className="form-input" />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexGrow: 1 }}>
                        <strong>Category:</strong>
                        <select value={newFoodCat} onChange={e => setNewFoodCat(e.target.value)} required className="form-input">
                            <option value="" disabled>Select Category</option>
                            {categories.map(c => <option key={c} value={c}>{c}</option>)}
                            <option value="NEW">+ Create New Category</option>
                        </select>
                    </label>
                    {newFoodCat === 'NEW' && (
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexGrow: 1 }}>
                            <strong>New Category Name:</strong>
                            <input type="text" value={customCat} onChange={e => setCustomCat(e.target.value)} required className="form-input" />
                        </label>
                    )}
                    <button type="submit" className="form-btn" style={{ background: '#2563eb', flexBasis: 'auto', height: '35px' }}>Add Item</button>
                </form>
            </div>

            {Object.keys(categorized).length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', border: '2px dashed #cbd5e1', borderRadius: '8px' }}>
                    No custom items found for this list. Add one above!
                </div>
            )}

            {Object.keys(categorized).map(cat => (
                <div key={cat} style={{ background: 'white', padding: '15px', borderRadius: '8px', border: '2px solid #cbd5e1' }}>
                    <h3 style={{ margin: '0 0 15px 0', borderBottom: '2px solid #e2e8f0', paddingBottom: '8px' }}>{cat}</h3>
                    {categorized[cat].map(item => (
                        <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px', marginBottom: '5px', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                            {editingFood && editingFood.oldName === item.name ? (
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexGrow: 1 }}>
                                    <input type="text" value={editingFood.name} onChange={e => setEditingFood({...editingFood, name: e.target.value})} className="form-input" style={{ width: '150px', padding: '4px' }} />
                                    <select value={editingFood.category} onChange={e => setEditingFood({...editingFood, category: e.target.value})} className="form-input" style={{ padding: '4px' }}>
                                        {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <button onClick={handleEditSave} style={{ padding: '4px 8px', background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Save</button>
                                    <button onClick={() => setEditingFood(null)} style={{ padding: '4px 8px', background: '#64748b', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
                                </div>
                            ) : (
                                <>
                                    <span style={{ fontWeight: '500' }}>{item.name}</span>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button onClick={() => setEditingFood({ oldName: item.name, name: item.name, category: cat })} style={{ padding: '2px 8px', background: '#e2e8f0', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Edit</button>
                                        <button onClick={() => handleDelete(item.name)} style={{ padding: '2px 8px', background: '#fca5a5', color: '#7f1d1d', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Delete</button>
                                    </div>
                                </>
                            )}
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}
