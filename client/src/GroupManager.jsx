import React, { useState } from 'react';

export default function GroupManager({ groups, token, impersonatingId, apiFetch, refreshTrigger }) {
    const [newGroupName, setNewGroupName] = useState('');
    const [createUsername, setCreateUsername] = useState('');
    const [createDisplayName, setCreateDisplayName] = useState('');
    const [createPassword, setCreatePassword] = useState('');
    const [linkCodeInput, setLinkCodeInput] = useState('');
    const [editingMemberId, setEditingMemberId] = useState(null);
    const [editMemberName, setEditMemberName] = useState('');

    const createGroup = async (e) => {
        e.preventDefault();
        const res = await apiFetch('/api/groups/create', token, impersonatingId, { method: 'POST', body: JSON.stringify({ name: newGroupName.trim() }) });
        const data = await res.json();
        if (data.success) { setNewGroupName(''); refreshTrigger(); alert("Group Created!"); } else alert(data.error);
    };

    const joinGroup = async (e) => {
        e.preventDefault();
        const res = await apiFetch('/api/groups/join', token, impersonatingId, { method: 'POST', body: JSON.stringify({ joinCode: linkCodeInput.trim() }) });
        const data = await res.json();
        if (data.success) { setLinkCodeInput(''); refreshTrigger(); alert("Joined Group!"); } else alert(data.error);
    };

    const createMemberInGroup = async (e, groupId) => {
        e.preventDefault();
        const res = await apiFetch(`/api/groups/${groupId}/create_user`, token, impersonatingId, { method: 'POST', body: JSON.stringify({ username: createUsername.trim(), displayName: createDisplayName.trim() || createUsername.trim(), password: createPassword }) });
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '800px' }}>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                <form onSubmit={createGroup} className="form-group">
                    <strong style={{ width: '100%' }}>Create a New Group:</strong>
                    <input type="text" placeholder="Group Name (e.g. LTS Workspace)" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} required className="form-input"/>
                    <button type="submit" className="form-btn" style={{ background: '#2563eb' }}>Create Group</button>
                </form>
                <form onSubmit={joinGroup} className="form-group">
                    <strong style={{ width: '100%' }}>Join Existing Group:</strong>
                    <input type="text" placeholder="Group PIN" value={linkCodeInput} onChange={e => setLinkCodeInput(e.target.value)} required className="form-input"/>
                    <button type="submit" className="form-btn" style={{ background: '#10b981' }}>Join Group</button>
                </form>
            </div>
            {groups.map(g => (
                <div key={g.id} style={{ background: 'white', padding: '15px', borderRadius: '8px', border: '2px solid #cbd5e1', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px', marginBottom: '15px' }}>
                        <h3 style={{ margin: 0 }}>{g.name}</h3>
                        <span style={{ background: '#fef3c7', padding: '6px 12px', borderRadius: '4px', border: '1px solid #fcd34d' }}><strong>Group PIN:</strong> {g.join_code}</span>
                    </div>
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
                                    <button onClick={() => { setEditingMemberId(m.id); setEditMemberName(m.name); }} style={{ padding: '2px 8px', background: '#e2e8f0', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Edit Name</button>
                                </div>
                            )}
                            <div style={{ display: 'flex', gap: '4px' }}>
                                <button onClick={() => shiftColumn(g.id, g.members, idx, -1)} style={{ padding: '4px 8px', cursor: 'pointer', border: '1px solid #cbd5e1', background: 'white', borderRadius: '4px' }}>Up</button>
                                <button onClick={() => shiftColumn(g.id, g.members, idx, 1)} style={{ padding: '4px 8px', cursor: 'pointer', border: '1px solid #cbd5e1', background: 'white', borderRadius: '4px' }}>Down</button>
                            </div>
                        </div>
                    ))}
                    <form onSubmit={(e) => createMemberInGroup(e, g.id)} style={{ display: 'flex', gap: '8px', marginTop: '15px', padding: '10px', background: '#f1f5f9', borderRadius: '4px', flexWrap: 'wrap' }}>
                        <input type="text" placeholder="Username (Login ID)" value={createUsername} onChange={e => setCreateUsername(e.target.value)} required className="form-input"/>
                        <input type="text" placeholder="Display Name" value={createDisplayName} onChange={e => setCreateDisplayName(e.target.value)} className="form-input"/>
                        <input type="password" placeholder="Password" value={createPassword} onChange={e => setCreatePassword(e.target.value)} required className="form-input"/>
                        <button type="submit" className="form-btn" style={{ background: '#3b82f6' }}>Create Account</button>
                    </form>
                </div>
            ))}
        </div>
    );
}
