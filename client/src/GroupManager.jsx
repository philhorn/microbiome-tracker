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
            {groups.map(g => (
                <GroupCard key={g.id} g={g} token={token} impersonatingId={impersonatingId} apiFetch={apiFetch} refreshTrigger={refreshTrigger} />
            ))}
        </div>
    );
}

function GroupCard({ g, token, impersonatingId, apiFetch, refreshTrigger }) {
    const [editingMemberId, setEditingMemberId] = useState(null);
    const [editMemberName, setEditMemberName] = useState('');
    const [editingGroupId, setEditingGroupId] = useState(false);
    const [editGroupName, setEditGroupName] = useState(g.name);
    
    // Tracking Mode Isolation Engine
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
        
        if (data.success) { 
            setBulkLinks([{ username: '', linkCode: '' }]); 
            refreshTrigger(); 
            if (data.errors && data.errors.length > 0) alert(`Added ${data.added} users.\n\nFailed to add:\n${data.errors.join('\n')}`);
            else alert(`Successfully added ${data.added} user(s)!`);
        } else alert(data.error);
    };

    const saveGroupName = async () => {
        if (!editGroupName.trim()) return;
        await apiFetch(`/api/groups/${g.id}`, token, impersonatingId, { method: 'PUT', body: JSON.stringify({ name: editGroupName.trim() }) });
        setEditingGroupId(false); refreshTrigger();
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
        <div style={{ background: 'white', padding: '15px', borderRadius: '8px', border: '2px solid #cbd5e1', marginBottom: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px', marginBottom: '15px', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {editingGroupId ? (
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <input value={editGroupName} onChange={e=>setEditGroupName(e.target.value)} className="form-input" style={{ width: '150px', padding: '4px' }}/>
                            <button onClick={saveGroupName} style={{ padding: '4px 8px', background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Save</button>
                            <button onClick={()=>setEditingGroupId(false)} style={{ padding: '4px 8px', background: '#64748b', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
                        </div>
                    ) : (
                        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                            {g.name}
                            <button onClick={() => { setEditingGroupId(true); setEditGroupName(g.name); }} style={{ fontSize: '12px', padding: '2px 8px', background: '#e2e8f0', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Edit Name</button>
                        </h3>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px' }}>
                        <button onClick={toggleIsolation} style={{ padding: '4px 12px', borderRadius: '15px', border: '1px solid #cbd5e1', background: isIsolated ? '#fef2f2' : '#f0fdf4', color: isIsolated ? '#991b1b' : '#166534', cursor: 'pointer', fontWeight: 'bold' }}>
                            {isIsolated ? '🔒 Isolated Checklist' : '🌐 Unified Checklist'}
                        </button>
                        <span style={{ color: '#64748b', fontStyle: 'italic', fontSize: '12px' }}>
                            {isIsolated ? "Checks stay strictly inside this group." : "Global checks auto-sync to other Unified groups."}
                        </span>
                    </div>
                </div>
                <span style={{ background: '#fef3c7', padding: '6px 12px', borderRadius: '4px', border: '1px solid #fcd34d' }}><strong>Group PIN:</strong> {g.join_code}</span>
            </div>
            
            <strong style={{ display: 'block', marginBottom: '10px' }}>Group Members:</strong>
            {g.members.map((m, idx) => (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px', marginBottom: '5px', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                    {editingMemberId === m.id ? (
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input type="text" value={editMemberName} onChange={(e) => setEditMemberName(e.target.value)} className="form-input" style={{ width: '150px', padding: '4px' }} />
                            <button onClick={() => saveMemberName(m.id)} style={{ padding: '4px 8px', background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Save</button>
                            <button onClick={() => setEditingMemberId(null)} style={{ padding: '4px 8px', background: '#64748b', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <span style={{ fontWeight: 'bold' }}>{m.name}</span>
                            <button onClick={() => { setEditingMemberId(m.id); setEditMemberName(m.name); }} style={{ padding: '2px 8px', background: '#e2e8f0', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Rename</button>
                            <button onClick={() => removeMember(m.id)} style={{ padding: '2px 8px', background: '#fca5a5', color: '#7f1d1d', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Remove</button>
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: '4px' }}>
                        <button onClick={() => shiftColumn(g.id, g.members, idx, -1)} style={{ padding: '4px 8px', cursor: 'pointer', border: '1px solid #cbd5e1', background: 'white', borderRadius: '4px' }}>Up</button>
                        <button onClick={() => shiftColumn(g.id, g.members, idx, 1)} style={{ padding: '4px 8px', cursor: 'pointer', border: '1px solid #cbd5e1', background: 'white', borderRadius: '4px' }}>Down</button>
                    </div>
                </div>
            ))}

            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginTop: '15px' }}>
                <form onSubmit={createMemberInGroup} style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: '#f1f5f9', borderRadius: '4px', flexGrow: 1 }}>
                    <strong style={{ fontSize: '14px', color: '#475569' }}>Create New Account Here:</strong>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <input type="text" placeholder="Username" value={createUsername} onChange={e => setCreateUsername(e.target.value)} required className="form-input"/>
                        <input type="text" placeholder="Display Name" value={createDisplayName} onChange={e => setCreateDisplayName(e.target.value)} className="form-input"/>
                        <input type="password" placeholder="Password" value={createPassword} onChange={e => setCreatePassword(e.target.value)} required className="form-input"/>
                        <button type="submit" className="form-btn" style={{ background: '#3b82f6', flexBasis: '100%' }}>Create Account</button>
                    </div>
                </form>

                <form onSubmit={addExistingUsersBulk} style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: '#f1f5f9', borderRadius: '4px', flexGrow: 1 }}>
                    <strong style={{ fontSize: '14px', color: '#475569' }}>Add Existing User(s):</strong>
                    {bulkLinks.map((link, idx) => (
                        <div key={idx} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <input type="text" placeholder="Their Username" value={link.username} onChange={e => handleBulkChange(idx, 'username', e.target.value)} required={idx === 0} className="form-input"/>
                            <input type="text" placeholder="Their Personal PIN" value={link.linkCode} onChange={e => handleBulkChange(idx, 'linkCode', e.target.value)} required={idx === 0} className="form-input"/>
                            {bulkLinks.length > 1 && (
                                <button type="button" onClick={() => removeBulkRow(idx)} style={{ padding: '8px 12px', background: '#fca5a5', color: '#7f1d1d', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>X</button>
                            )}
                        </div>
                    ))}
                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                        <button type="button" onClick={addBulkRow} style={{ padding: '8px 16px', background: '#e2e8f0', color: '#475569', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer', flexGrow: 1 }}>+ Add Another Row</button>
                        <button type="submit" className="form-btn" style={{ background: '#10b981', flexGrow: 2 }}>Add Users</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
