import React, { useState } from 'react';

export default function GroupManager({ groups, token, impersonatingId, apiFetch, refreshTrigger }) {
    const [newGroupName, setNewGroupName] = useState('');
    const [joinGroupPin, setJoinGroupPin] = useState('');

    const createGroup = async (e) => {
        e.preventDefault();
        const res = await apiFetch('/api/groups/create', token, impersonatingId, { method: 'POST', body: JSON.stringify({ name: newGroupName.trim() }) });
        const data = await res.json();
        if (data.success) { setNewGroupName(''); refreshTrigger(); alert("Group Created!"); } else alert(data.error);
    };

    const joinGroup = async (e) => {
        e.preventDefault();
        const res = await apiFetch('/api/groups/join', token, impersonatingId, { method: 'POST', body: JSON.stringify({ joinCode: joinGroupPin.trim() }) });
        const data = await res.json();
        if (data.success) { setJoinGroupPin(''); refreshTrigger(); alert("Joined Group!"); } else alert(data.error);
    };

    const handleJumpToPosition = async (targetGroupId, newIndex) => {
        const currentGroups = [...groups];
        const currentIndex = currentGroups.findIndex(g => g.id === targetGroupId);
        if (currentIndex === -1) return;

        const [movedGroup] = currentGroups.splice(currentIndex, 1);
        currentGroups.splice(newIndex, 0, movedGroup);

        await apiFetch('/api/groups/reorder', token, impersonatingId, { method: 'POST', body: JSON.stringify({ order: currentGroups.map(g => g.id) }) });
        refreshTrigger();
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '800px' }}>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                <form onSubmit={createGroup} className="form-group">
                    <strong style={{ width: '100%' }}>Create a New Group:</strong>
                    <input type="text" placeholder="Group Name (e.g. LTS Workspace)" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} required className="form-input"/>
                    <button type="submit" className="form-btn" style={{ background: '#2563eb' }}>Create Group</button>
                </form>
                <form onSubmit={joinGroup} className="form-group">
                    <strong style={{ width: '100%' }}>Join via Group PIN:</strong>
                    <input type="text" placeholder="Group PIN" value={joinGroupPin} onChange={e => setJoinGroupPin(e.target.value)} required className="form-input"/>
                    <button type="submit" className="form-btn" style={{ background: '#10b981' }}>Join Group</button>
                </form>
            </div>
            {groups.map((g, idx) => (
                <GroupCard key={g.id} g={g} index={idx} totalGroups={groups.length} handleJumpToPosition={handleJumpToPosition} token={token} impersonatingId={impersonatingId} apiFetch={apiFetch} refreshTrigger={refreshTrigger} />
            ))}
        </div>
    );
}

function GroupCard({ g, index, totalGroups, handleJumpToPosition, token, impersonatingId, apiFetch, refreshTrigger }) {
    const [editingMemberId, setEditingMemberId] = useState(null);
    const [editMemberName, setEditMemberName] = useState('');
    
    // Sleek inline state for group branding
    const [editGroupName, setEditGroupName] = useState(g.name);
    const [editAppName, setEditAppName] = useState(g.app_name || '');
    const [editThemeColor, setEditThemeColor] = useState(g.theme_color || '#2563eb');
    const [editLogoUrl, setEditLogoUrl] = useState(g.logo_url || '');
    
    const [isIsolated, setIsIsolated] = useState(g.isolate_tracker === 1);
    
    const [createUsername, setCreateUsername] = useState('');
    const [createDisplayName, setCreateDisplayName] = useState('');
    const [createPassword, setCreatePassword] = useState('');
    const [bulkLinks, setBulkLinks] = useState([{ username: '', linkCode: '' }]);

    const toggleIsolation = async () => {
        const newVal = !isIsolated;
        setIsIsolated(newVal);
        await apiFetch(`/api/groups/${g.id}/mode`, token, impersonatingId, { method: 'PUT', body: JSON.stringify({ isolated: newVal }) });
        refreshTrigger();
    };

    const handleBulkChange = (index, field, val) => {
        const newLinks = [...bulkLinks];
        newLinks[index][field] = val;
        setBulkLinks(newLinks);
    };
    const addBulkRow = () => setBulkLinks([...bulkLinks, { username: '', linkCode: '' }]);
    const removeBulkRow = (index) => setBulkLinks(bulkLinks.filter((_, i) => i !== index));

    const addExistingUsersBulk = async (e) => {
        e.preventDefault();
        const toAdd = bulkLinks.filter(l => l.username.trim() !== '' && l.linkCode.trim() !== '');
        if (toAdd.length === 0) return;
        const res = await apiFetch(`/api/groups/${g.id}/add_users_bulk`, token, impersonatingId, { method: 'POST', body: JSON.stringify({ users: toAdd }) });
        const data = await res.json();
        if (data.success) { setBulkLinks([{ username: '', linkCode: '' }]); refreshTrigger(); alert(`Added ${data.added} users.`); } else alert(data.error);
    };

    // Auto-save branding changes on blur or change to eliminate clunky save buttons
    const saveGroupSettingsField = async (updatedFields) => {
        const payload = {
            name: updatedFields.name !== undefined ? updatedFields.name : editGroupName,
            appName: updatedFields.appName !== undefined ? updatedFields.appName : editAppName,
            themeColor: updatedFields.themeColor !== undefined ? updatedFields.themeColor : editThemeColor,
            logoUrl: updatedFields.logoUrl !== undefined ? updatedFields.logoUrl : editLogoUrl
        };
        if (!payload.name.trim()) return;
        await apiFetch(`/api/groups/${g.id}`, token, impersonatingId, { method: 'PUT', body: JSON.stringify({ name: payload.name.trim(), appName: payload.appName.trim() || null, themeColor: payload.themeColor || null, logoUrl: payload.logoUrl.trim() || null }) });
        refreshTrigger();
    };

    const removeMember = async (userId) => {
        if (!window.confirm("Remove this user from the group?")) return;
        await apiFetch(`/api/groups/${g.id}/member/${userId}`, token, impersonatingId, { method: 'DELETE' });
        refreshTrigger();
    };

    const createMemberInGroup = async (e) => {
        e.preventDefault();
        const res = await apiFetch(`/api/groups/${g.id}/create_user`, token, impersonatingId, { method: 'POST', body: JSON.stringify({ username: createUsername.trim(), displayName: createDisplayName.trim() || createUsername.trim(), password: createPassword }) });
        const data = await res.json();
        if (data.success) { setCreateUsername(''); setCreateDisplayName(''); setCreatePassword(''); refreshTrigger(); alert("Account Created!"); } else alert(data.error);
    };

    const saveMemberName = async (id) => {
        if (!editMemberName.trim()) return;
        await apiFetch(`/api/groups/member/${id}`, token, impersonatingId, { method: 'PUT', body: JSON.stringify({ displayName: editMemberName.trim() }) });
        setEditingMemberId(null); refreshTrigger();
    };

    const shiftColumn = async (groupId, membersArray, index, direction) => {
        const newArr = [...membersArray];
        if (direction === -1 && index > 0) [newArr[index - 1], newArr[index]] = [newArr[index], newArr[index - 1]];
        else if (direction === 1 && index < newArr.length - 1) [newArr[index + 1], newArr[index]] = [newArr[index], newArr[index + 1]];
        else return;
        await apiFetch(`/api/groups/${groupId}/reorder`, token, impersonatingId, { method: 'POST', body: JSON.stringify({ order: newArr.map(m => m.id) }) });
        refreshTrigger();
    };

    return (
        <div style={{ background: 'white', padding: '20px', borderRadius: '8px', border: '2px solid #cbd5e1', marginBottom: '15px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #e2e8f0', paddingBottom: '15px', marginBottom: '15px', flexWrap: 'wrap', gap: '15px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flexGrow: 1, width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {g.logo_url && <img src={g.logo_url} alt="Logo" style={{ height: '28px', borderRadius: '4px' }} />}
                        <h3 style={{ margin: 0 }}>{g.name}</h3>
                        <span style={{ marginLeft: 'auto', background: '#fef3c7', padding: '6px 12px', borderRadius: '6px', border: '1px solid #fcd34d', fontSize: '13px' }}><strong>Group PIN:</strong> {g.join_code}</span>
                    </div>

                    {/* Sleek Professional Single-Line Inputs for Branding */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', background: '#f8fafc', padding: '15px', borderRadius: '8px', border: '1px solid #e2e8f0', alignItems: 'center' }}>
                        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '12px', fontWeight: 'bold', flex: '1 1 180px' }}>
                            Group Name: 
                            <input type="text" value={editGroupName} onChange={e=>setEditGroupName(e.target.value)} onBlur={()=>saveGroupSettingsField({name: editGroupName})} className="form-input" style={{marginTop: '4px', width: '100%'}}/>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '12px', fontWeight: 'bold', flex: '1 1 180px' }}>
                            Custom App Name: 
                            <input type="text" value={editAppName} onChange={e=>setEditAppName(e.target.value)} onBlur={()=>saveGroupSettingsField({appName: editAppName})} placeholder="e.g. Test App Name" className="form-input" style={{marginTop: '4px', width: '100%'}}/>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '12px', fontWeight: 'bold', flex: '1 1 180px' }}>
                            Logo Image URL: 
                            <input type="text" value={editLogoUrl} onChange={e=>setEditLogoUrl(e.target.value)} onBlur={()=>saveGroupSettingsField({logoUrl: editLogoUrl})} placeholder="https://..." className="form-input" style={{marginTop: '4px', width: '100%'}}/>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '12px', fontWeight: 'bold' }}>
                            Theme Color: 
                            <input type="color" value={editThemeColor} onChange={e=>{setEditThemeColor(e.target.value); saveGroupSettingsField({themeColor: e.target.value});}} style={{ padding: 0, height: '38px', width: '55px', cursor: 'pointer', border: '1px solid #cbd5e1', borderRadius: '6px', marginTop: '4px' }}/>
                        </label>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px', fontSize: '14px', marginTop: '5px', flexWrap: 'wrap' }}>
                        <button onClick={toggleIsolation} style={{ height: '38px', padding: '0 14px', borderRadius: '6px', border: '1px solid #cbd5e1', background: isIsolated ? '#fef2f2' : '#f0fdf4', color: isIsolated ? '#991b1b' : '#166534', cursor: 'pointer', fontWeight: 'bold' }}>
                            {isIsolated ? '🔒 Isolated Checklist' : '🌐 Unified Checklist'}
                        </button>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#475569', fontWeight: 'bold', marginLeft: 'auto' }}>
                            Display Position:
                            <select value={index} onChange={(e) => handleJumpToPosition(g.id, parseInt(e.target.value))} style={{ height: '38px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1', background: 'white', fontWeight: 'bold' }}>
                                {Array.from({ length: totalGroups }, (_, i) => (
                                    <option key={i} value={i}>Position {i + 1} of {totalGroups}</option>
                                ))}
                            </select>
                        </label>
                    </div>
                </div>
            </div>
            
            <strong style={{ display: 'block', marginBottom: '10px' }}>Group Members:</strong>
            {g.members.map((m, idx) => (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', marginBottom: '6px', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                    {editingMemberId === m.id ? (
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input type="text" value={editMemberName} onChange={(e) => setEditMemberName(e.target.value)} className="form-input" style={{ width: '150px', height: '32px', margin: 0 }} />
                            <button onClick={() => saveMemberName(m.id)} style={{ height: '32px', padding: '0 12px', background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Save</button>
                            <button onClick={() => setEditingMemberId(null)} style={{ height: '32px', padding: '0 12px', background: '#64748b', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <span style={{ fontWeight: 'bold' }}>{m.name}</span>
                            <button onClick={() => { setEditingMemberId(m.id); setEditMemberName(m.name); }} style={{ height: '28px', padding: '0 10px', background: '#e2e8f0', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>Rename</button>
                            <button onClick={() => removeMember(m.id)} style={{ height: '28px', padding: '0 10px', background: '#fca5a5', color: '#7f1d1d', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>Remove</button>
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: '4px' }}>
                        <button onClick={() => shiftColumn(g.id, g.members, idx, -1)} style={{ height: '32px', padding: '0 10px', cursor: 'pointer', border: '1px solid #cbd5e1', background: 'white', borderRadius: '4px', fontWeight: 'bold' }}>Up</button>
                        <button onClick={() => shiftColumn(g.id, g.members, idx, 1)} style={{ height: '32px', padding: '0 10px', cursor: 'pointer', border: '1px solid #cbd5e1', background: 'white', borderRadius: '4px', fontWeight: 'bold' }}>Down</button>
                    </div>
                </div>
            ))}

            <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', marginTop: '15px' }}>
                <form onSubmit={createMemberInGroup} style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', background: '#f1f5f9', borderRadius: '6px', flexGrow: 1 }}>
                    <strong style={{ fontSize: '13px', color: '#475569' }}>Create New Account Here:</strong>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <input type="text" placeholder="Username" value={createUsername} onChange={e => setCreateUsername(e.target.value)} required className="form-input" style={{flex: '1 1 100px'}}/>
                        <input type="text" placeholder="Display Name" value={createDisplayName} onChange={e => setCreateDisplayName(e.target.value)} className="form-input" style={{flex: '1 1 100px'}}/>
                        <input type="password" placeholder="Password" value={createPassword} onChange={e => setCreatePassword(e.target.value)} required className="form-input" style={{flex: '1 1 100px'}}/>
                        <button type="submit" className="form-btn" style={{ flexBasis: '100%', height: '38px' }}>Create Account</button>
                    </div>
                </form>
                <form onSubmit={addExistingUsersBulk} style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', background: '#f1f5f9', borderRadius: '6px', flexGrow: 1 }}>
                    <strong style={{ fontSize: '13px', color: '#475569' }}>Add Existing User(s):</strong>
                    {bulkLinks.map((link, idx) => (
                        <div key={idx} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <input type="text" placeholder="Their Username" value={link.username} onChange={e => handleBulkChange(idx, 'username', e.target.value)} required={idx === 0} className="form-input" style={{flex: '1 1 100px'}}/>
                            <input type="text" placeholder="Their Personal PIN" value={link.linkCode} onChange={e => handleBulkChange(idx, 'linkCode', e.target.value)} required={idx === 0} className="form-input" style={{flex: '1 1 100px'}}/>
                            {bulkLinks.length > 1 && <button type="button" onClick={() => removeBulkRow(idx)} style={{ height: '38px', padding: '0 12px', background: '#fca5a5', color: '#7f1d1d', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>X</button>}
                        </div>
                    ))}
                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                        <button type="button" onClick={addBulkRow} style={{ height: '38px', padding: '0 12px', background: '#e2e8f0', color: '#475569', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', flexGrow: 1 }}>+ Add Row</button>
                        <button type="submit" className="form-btn" style={{ background: '#10b981', flexGrow: 2, height: '38px' }}>Add Users</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
