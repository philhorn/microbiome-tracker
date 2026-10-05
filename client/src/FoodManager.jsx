import React, { useState } from 'react';

export default function FoodManager({ categorizedFoods, token, impersonatingId, apiFetch, refreshTrigger }) {
    const [newFoodName, setNewFoodName] = useState('');
    const [newFoodCat, setNewFoodCat] = useState('');
    const [customCat, setCustomCat] = useState('');

    const [editingFood, setEditingFood] = useState(null);

    const categories = Object.keys(categorizedFoods);

    const handleAdd = async (e) => {
        e.preventDefault();
        const cat = newFoodCat === 'NEW' ? customCat : newFoodCat;
        if (!cat || !newFoodName) return alert('Name and Category required');
        
        const res = await apiFetch('/api/foods/manage', token, impersonatingId, { method: 'POST', body: JSON.stringify({ action: 'add', name: newFoodName, category: cat }) });
        const data = await res.json();
        if (data.success) {
            setNewFoodName(''); setCustomCat(''); setNewFoodCat('');
            refreshTrigger();
            alert('Food added!');
        } else alert(data.error);
    };

    const handleEditSave = async () => {
        if (!editingFood.name || !editingFood.category) return;
        const res = await apiFetch('/api/foods/manage', token, impersonatingId, { method: 'POST', body: JSON.stringify({ action: 'edit', oldName: editingFood.oldName, name: editingFood.name, category: editingFood.category }) });
        const data = await res.json();
        if (data.success) {
            setEditingFood(null);
            refreshTrigger();
        } else alert(data.error);
    };

    const handleDelete = async (name) => {
        if (!window.confirm(`Delete "${name}"? This will permanently wipe this item from all user trackers.`)) return;
        const res = await apiFetch('/api/foods/manage', token, impersonatingId, { method: 'POST', body: JSON.stringify({ action: 'delete', name }) });
        const data = await res.json();
        if (data.success) refreshTrigger(); else alert(data.error);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '800px' }}>
            <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <h3 style={{ marginTop: 0 }}>Add New Food Item</h3>
                <form onSubmit={handleAdd} style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexGrow: 1 }}>
                        <strong>Food Name:</strong>
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
                    <button type="submit" className="form-btn" style={{ background: '#2563eb', flexBasis: 'auto', height: '35px' }}>Add Food</button>
                </form>
            </div>

            {categories.map(cat => (
                <div key={cat} style={{ background: 'white', padding: '15px', borderRadius: '8px', border: '2px solid #cbd5e1' }}>
                    <h3 style={{ margin: '0 0 15px 0', borderBottom: '2px solid #e2e8f0', paddingBottom: '8px' }}>{cat}</h3>
                    {categorizedFoods[cat].map(food => (
                        <div key={food} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px', marginBottom: '5px', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                            {editingFood && editingFood.oldName === food ? (
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
                                    <span style={{ fontWeight: '500' }}>{food}</span>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button onClick={() => setEditingFood({ oldName: food, name: food, category: cat })} style={{ padding: '2px 8px', background: '#e2e8f0', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Edit</button>
                                        <button onClick={() => handleDelete(food)} style={{ padding: '2px 8px', background: '#fca5a5', color: '#7f1d1d', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Delete</button>
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
