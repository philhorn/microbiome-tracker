import React, { useState } from 'react';

export default function AdminPanel({ adminUsers, sysSettings, token, apiFetch, refreshTrigger, setImpersonatingUser }) {
    const [createUsername, setCreateUsername] = useState('');
    const [createDisplayName, setCreateDisplayName] = useState('');
    const [createPassword, setCreatePassword] = useState('');
    const [createRole, setCreateRole] = useState('dietitian');

    const handleCreateGlobalUser = async (e) => {
        e.preventDefault();
        const res = await apiFetch('/api/admin/create_user', token, null, { method: 'POST', body: JSON.stringify({ username: createUsername.trim(), displayName: createDisplayName.trim(), password: createPassword, role: createRole }) });
        const data = await res.json();
        if (data.success) { setCreateUsername(''); setCreateDisplayName(''); setCreatePassword(''); setCreateRole('dietitian'); refreshTrigger(); alert("User created successfully!"); } else alert(data.error);
    };

    const adminAction = async (id, action, payload) => {
        if (action === 'impersonate') { setImpersonatingUser({ id: payload.id, name: payload.display_name, username: payload.username, role: payload.role }); return; }
        if (action === 'delete' && !window.confirm("Permanently delete this user?")) return;
        const body = payload ? JSON.stringify({ role: payload }) : null;
        await apiFetch(`/api/admin/${action}/${id}`, token, null, { method: action === 'delete' ? 'DELETE' : 'POST', body });
        refreshTrigger();
    };
    
    const saveSetting = async (key, value) => {
        await apiFetch('/api/admin/settings', token, null, { method: 'PUT', body: JSON.stringify({ [key]: value }) });
        refreshTrigger();
    };
    
    const forceNewWeek = async () => {
        if (!window.confirm("Force create a new week right now?")) return;
        await apiFetch('/api/admin/force-week', token, null, { method: 'POST' });
        alert("New week created!"); refreshTrigger();
    };

    return (
        <>
            <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '30px' }}>
                <h3 style={{ marginTop: 0 }}>Global User Provisioning</h3>
                <form onSubmit={handleCreateGlobalUser} style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexGrow: 1 }}><strong>Username (Login ID):</strong><input type="text" value={createUsername} onChange={e => setCreateUsername(e.target.value)} required className="form-input" /></label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexGrow: 1 }}><strong>Display Name:</strong><input type="text" value={createDisplayName} onChange={e => setCreateDisplayName(e.target.value)} className="form-input" /></label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexGrow: 1 }}><strong>Password:</strong><input type="password" value={createPassword} onChange={e => setCreatePassword(e.target.value)} required className="form-input" /></label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexGrow: 1 }}><strong>Role:</strong>
                        <select value={createRole} onChange={e => setCreateRole(e.target.value)} className="form-input"><option value="user">User</option><option value="parent">Parent</option><option value="dietitian">Dietitian</option><option value="admin">Admin</option></select>
                    </label>
                    <button type="submit" style={{ padding: '8px 16px', background: 'var(--theme-color)', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer', height: '35px' }}>Create User</button>
                </form>
            </div>

            <div style={{ overflowX: 'auto', marginBottom: '30px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', background: 'white', border: '1px solid #e2e8f0' }}>
                    <thead><tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}><th style={{ padding: '12px' }}>ID</th><th style={{ padding: '12px' }}>User</th><th style={{ padding: '12px' }}>User PIN</th><th style={{ padding: '12px' }}>Role</th><th style={{ padding: '12px' }}>Status</th><th style={{ padding: '12px' }}>Actions</th></tr></thead>
                    <tbody>{adminUsers.map(u => (
                        <tr key={u.id} style={{ borderBottom: '1px solid #e2e8f0', background: u.is_suspended ? '#fee2e2' : 'white' }}>
                            <td style={{ padding: '12px' }}>{u.id}</td>
                            <td style={{ padding: '12px' }}><strong>{u.display_name}</strong><br/><span style={{fontSize: '0.85em', color: '#64748b'}}>{u.username}</span></td>
                            <td style={{ padding: '12px', fontWeight: 'bold' }}>{u.link_code}</td>
                            <td style={{ padding: '12px' }}><select value={u.role} onChange={(e) => adminAction(u.id, 'role', e.target.value)} disabled={u.username === 'admin'} style={{ padding: '4px', borderRadius: '4px' }}><option value="user">User</option><option value="parent">Parent</option><option value="dietitian">Dietitian</option><option value="admin">Admin</option></select></td>
                            <td style={{ padding: '12px' }}>{u.is_suspended ? 'Suspended' : (u.locked_until && new Date(u.locked_until) > new Date() ? 'Locked' : 'Active')}</td>
                            <td style={{ padding: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                <button onClick={() => adminAction(u.id, 'impersonate', u)} style={{ padding: '6px 10px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Impersonate</button>
                                <button onClick={() => adminAction(u.id, 'suspend')} disabled={u.username === 'admin'} style={{ padding: '6px 10px', background: u.is_suspended ? '#10b981' : '#f59e0b', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>{u.is_suspended ? 'Unsuspend' : 'Suspend'}</button>
                                <button onClick={() => adminAction(u.id, 'delete')} disabled={u.username === 'admin'} style={{ padding: '6px 10px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Delete</button>
                            </td>
                        </tr>
                    ))}</tbody>
                </table>
            </div>
            
            <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0', maxWidth: '600px' }}>
                <h3 style={{ marginTop: 0 }}>Global Branding & System Settings</h3>
                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '15px' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexGrow: 1 }}>
                        <strong>App Name:</strong>
                        <input type="text" value={sysSettings.app_name || ''} onChange={e => saveSetting('app_name', e.target.value)} className="form-input" placeholder="e.g. LTS Workspace" />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <strong>Theme Color:</strong>
                        <input type="color" value={sysSettings.theme_color || '#ef4444'} onChange={e => saveSetting('theme_color', e.target.value)} style={{ padding: '0', height: '35px', width: '60px', border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer' }} />
                    </label>
                </div>
                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-end', borderTop: '1px solid #e2e8f0', paddingTop: '15px' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <strong>Week Rollover Day:</strong>
                        <select value={sysSettings.rollover_day || '0'} onChange={e => saveSetting('rollover_day', e.target.value)} className="form-input" style={{ minWidth: '150px' }}>
                            <option value="0">Sunday</option><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option>
                        </select>
                    </label>
                    <button onClick={forceNewWeek} style={{ padding: '8px 16px', background: '#eab308', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', height: '35px' }}>Force Start New Week Now</button>
                </div>
            </div>
        </>
    );
}
