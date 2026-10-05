import { APP_VERSION } from "./version";
import React, { useState, useEffect } from 'react';
import { apiFetch } from './api';
import Auth from './Auth';
import TrackerGrid from './TrackerGrid';
import GroupManager from './GroupManager';
import AdminPanel from './AdminPanel';
import ListManager from './ListManager';

const APP_VERSION = "2026.10.04.21.5";

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [role, setRole] = useState(localStorage.getItem('role'));
  const [myName, setMyName] = useState(localStorage.getItem('name') || '');
  const [myUsername, setMyUsername] = useState(localStorage.getItem('username') || '');
  const [myLinkCode, setMyLinkCode] = useState(localStorage.getItem('linkCode') || '');
  const [myUserId, setMyUserId] = useState(localStorage.getItem('userId') || '');
  
  const [currentView, setCurrentView] = useState('tracker'); 
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState('ALL');
  const [sortMode, setSortMode] = useState('A-Z');
  
  const [groups, setGroups] = useState([]);
  const [visibleGroupIds, setVisibleGroupIds] = useState([]);
  const [weeks, setWeeks] = useState([]);
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [gridData, setGridData] = useState({});
  const [adminUsers, setAdminUsers] = useState([]);
  const [sysSettings, setSysSettings] = useState({});
  const [listItems, setListItems] = useState([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [setupNotice, setSetupNotice] = useState(false);
  
  const [impersonatingUser, setImpersonatingUser] = useState(null); 
  const activeRole = impersonatingUser ? impersonatingUser.role : role;
  const activeName = impersonatingUser ? impersonatingUser.name : myName;
  const activeUsername = impersonatingUser ? impersonatingUser.username : myUsername;
  const effectiveUserId = impersonatingUser ? impersonatingUser.id : parseInt(myUserId);
  
  const [profileName, setProfileName] = useState(activeName);
  const [profilePass, setProfilePass] = useState('');

  const hardReset = () => { localStorage.clear(); window.location.reload(); };

  useEffect(() => { fetch('/api/setup-status').then(r => r.json()).then(d => setSetupNotice(d.needsSetup)).catch(() => {}); }, []);

  useEffect(() => {
    if (token) {
        apiFetch('/api/lists', token, impersonatingUser?.id).then(r => r.json()).then(d => setListItems(d)).catch(() => {});
        apiFetch('/api/weeks', token, impersonatingUser?.id)
            .then(r => { if (!r.ok) { hardReset(); throw new Error('Auth failed'); } return r.json(); })
            .then(data => { setWeeks(data); if (data.length > 0 && !selectedWeek) setSelectedWeek(data[0].id); })
            .catch(() => {});
    }
  }, [token, refreshTrigger, impersonatingUser]);

  useEffect(() => {
    if (!token || !selectedWeek) return;
    if (activeRole === 'admin' && currentView === 'admin' && !impersonatingUser) {
      apiFetch('/api/admin/users', token, null).then(r => r.ok ? r.json() : hardReset()).then(d => setAdminUsers(Array.isArray(d) ? d : [])).catch(hardReset);
      apiFetch('/api/admin/settings', token, null).then(r => r.json()).then(d => setSysSettings(d)).catch(() => {});
    } else {
      apiFetch(`/api/groups/grid?weekId=${selectedWeek}`, token, impersonatingUser?.id)
        .then(r => r.ok ? r.json() : hardReset())
        .then(d => { 
            if (d && !d.error) { 
                setGroups(d.groups || []); 
                setGridData(d.grid || {});
                setVisibleGroupIds((d.groups || []).map(g => g.id));
            } 
        }).catch(hardReset);
    }
  }, [token, activeRole, selectedWeek, currentView, refreshTrigger, impersonatingUser]);

  const setAuthData = (newToken, newRole, newName, newUsername, newLinkCode, newUserId) => {
      localStorage.setItem('token', newToken); localStorage.setItem('role', newRole); 
      localStorage.setItem('name', newName); localStorage.setItem('username', newUsername);
      localStorage.setItem('linkCode', newLinkCode); localStorage.setItem('userId', newUserId);
      setToken(newToken); setRole(newRole); setMyName(newName); setMyUsername(newUsername); 
      setProfileName(newName); setMyLinkCode(newLinkCode); setMyUserId(newUserId);
  };

  const updateProfile = async (e) => {
    e.preventDefault();
    const res = await apiFetch('/api/user/profile', token, impersonatingUser?.id, { method: 'PUT', body: JSON.stringify({ displayName: profileName, newPassword: profilePass || undefined }) });
    const data = await res.json();
    if (data.success) { 
        if (impersonatingUser) setImpersonatingUser(prev => ({...prev, name: data.name}));
        else { localStorage.setItem('name', data.name); setMyName(data.name); }
        setProfilePass(''); alert("Profile updated!"); setRefreshTrigger(p => p + 1); 
    }
  };

  const handleUpgrade = async () => {
    if (!window.confirm("Convert this account to a Group Manager?")) return;
    const res = await apiFetch('/api/user/upgrade', token, impersonatingUser?.id, { method: 'POST' });
    const data = await res.json();
    if (data.success) { 
        if (impersonatingUser) setImpersonatingUser(prev => ({...prev, role: data.role}));
        else { localStorage.setItem('role', data.role); setRole(data.role); }
    }
  };

  const handleDeleteSelf = async () => {
    if (!window.confirm("WARNING: This permanently deletes your account and data. Proceed?")) return;
    await apiFetch('/api/user/delete', token, impersonatingUser?.id, { method: 'DELETE' });
    if (impersonatingUser) { setImpersonatingUser(null); setRefreshTrigger(p => p+1); } else { hardReset(); }
  };

  if (!token) return <Auth setAuthData={setAuthData} setupNotice={setupNotice} />;

  const displayedUsers = [];
  const seenIds = new Set();
  groups.filter(g => visibleGroupIds.includes(g.id)).forEach(g => {
      g.members.forEach(m => { if (!seenIds.has(m.id)) { seenIds.add(m.id); displayedUsers.push(m); } });
  });

  return (
    <div className="app-container" style={{ fontFamily: 'system-ui', maxWidth: '1200px', margin: '0 auto', padding: '15px' }}>
      <style>{`
        .form-group { display: flex; gap: 8px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; borderRadius: 8px; flex-grow: 1; flex-wrap: wrap; align-items: center; }
        .form-input { padding: 8px; border-radius: 4px; border: 1px solid #cbd5e1; flex: 1 1 120px; }
        .form-btn { padding: 8px 16px; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; flex: 1 1 100%; }
        .nav-btn { padding: 8px 16px; border: none; background: none; cursor: pointer; font-weight: bold; color: #64748b; border-bottom: 2px solid transparent; }
        .nav-btn.active { color: #2563eb; border-bottom: 2px solid #2563eb; }
        .food-col { position: sticky; left: 0; z-index: 30; background: white; }
        .person-col { position: sticky; top: 0; z-index: 20; }
        .top-left-corner { position: sticky; top: 0; left: 0; z-index: 40; background: #f8fafc; }
        .cell-pad { padding: 10px 12px; position: relative; }
        .drag-handle { position: absolute; right: 0; top: 0; width: 15px; height: 100%; cursor: col-resize; z-index: 25; }
        .drag-handle:hover { background: rgba(0,0,0,0.05); }
        @media (max-width: 768px) {
          .app-container { padding: 10px; }
          .form-group { flex-direction: column; align-items: stretch; }
          .form-input { flex: 1 1 100%; width: 100%; box-sizing: border-box; }
          .cell-pad { padding: 8px 6px; font-size: 14px; }
        }
      `}</style>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '15px' }}>
        <div>
          <h2 style={{ margin: '0 0 4px 0' }}>Hi, {activeName} <span style={{fontSize: '16px', color: '#64748b', fontWeight: 'normal'}}>({activeUsername})</span></h2>
          {impersonatingUser && (
            <div style={{ background: '#fef08a', padding: '6px 12px', borderRadius: '4px', display: 'inline-block', marginBottom: '8px', border: '1px solid #fde047', fontSize: '14px' }}>
                <strong>Impersonating:</strong> {impersonatingUser.name} 
                <button onClick={() => { setImpersonatingUser(null); setProfileName(myName); setRefreshTrigger(p=>p+1); }} style={{ marginLeft: '10px', padding: '2px 8px', background: '#eab308', border: 'none', borderRadius: '4px', cursor: 'pointer', color: 'white' }}>Exit</button>
            </div>
          )}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button className={`nav-btn ${currentView === 'tracker' ? 'active' : ''}`} onClick={() => setCurrentView('tracker')}>Checklists</button>
            {(activeRole === 'parent' || activeRole === 'admin') && <button className={`nav-btn ${currentView === 'groups' ? 'active' : ''}`} onClick={() => setCurrentView('groups')}>Group Settings</button>}
            <button className={`nav-btn ${currentView === 'profile' ? 'active' : ''}`} onClick={() => setCurrentView('profile')}>Profile</button>
            <button className={`nav-btn ${currentView === 'about' ? 'active' : ''}`} onClick={() => setCurrentView('about')}>About</button>
            {!impersonatingUser && (activeRole === 'admin' || activeRole === 'dietitian' || activeRole === 'parent') && <button className={`nav-btn ${currentView === 'lists' ? 'active' : ''}`} onClick={() => setCurrentView('lists')}>Checklist Manager</button>}
            {!impersonatingUser && activeRole === 'admin' && <button className={`nav-btn ${currentView === 'admin' ? 'active' : ''}`} onClick={() => setCurrentView('admin')}>Admin</button>}
          </div>
        </div>
        <button onClick={hardReset} style={{ padding: '8px 16px', background: '#e2e8f0', color: '#334155', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Log Out</button>
      </div>

      {currentView === 'about' && (
        <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0', lineHeight: '1.6' }}>
          <h3>Multi-Tenant Checklist Engine</h3>
          <p>This tracking engine is designed to accommodate multiple groups seamlessly. Whether tracking weekly food intake or managing workspace opening procedures, each checklist belongs to its designated group.</p>
        </div>
      )}

      {currentView === 'profile' && (
        <div style={{ maxWidth: '600px' }}>
          {!impersonatingUser && (
              <div style={{ background: '#fef3c7', padding: '20px', borderRadius: '8px', border: '1px solid #fcd34d', marginBottom: '20px' }}>
                <h3 style={{ margin: '0 0 10px 0', color: '#92400e' }}>Personal Connection PIN: <span style={{ letterSpacing: '2px', fontSize: '24px', marginLeft: '10px', background: 'white', padding: '4px 8px', borderRadius: '4px' }}>{myLinkCode}</span></h3>
                <p style={{ margin: 0, fontSize: '14px', color: '#92400e' }}>Give this PIN to a Group Manager so they can pull you into their group.</p>
              </div>
          )}
          <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '20px' }}>
            <h3 style={{ marginTop: 0 }}>Update Profile</h3>
            <form onSubmit={updateProfile} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label><strong>Display Name:</strong> <input type="text" value={profileName} onChange={e => setProfileName(e.target.value)} required className="form-input" style={{ width: '100%', marginTop: '4px' }}/></label>
              <label><strong>New Password:</strong> <input type="password" placeholder="Leave blank to keep current password" value={profilePass} onChange={e => setProfilePass(e.target.value)} className="form-input" style={{ width: '100%', marginTop: '4px' }}/></label>
              <button type="submit" className="form-btn" style={{ background: '#2563eb' }}>Save Changes</button>
            </form>
          </div>
          <div style={{ background: '#fee2e2', padding: '20px', borderRadius: '8px', border: '1px solid #fca5a5' }}>
            <h3 style={{ marginTop: 0, color: '#991b1b' }}>Danger Zone</h3>
            <div style={{ display: 'flex', gap: '10px' }}>
              {activeRole === 'user' && <button onClick={handleUpgrade} style={{ padding: '8px 12px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Upgrade to Group Manager</button>}
              <button onClick={handleDeleteSelf} style={{ padding: '8px 12px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Delete Account</button>
            </div>
          </div>
        </div>
      )}

      {currentView === 'groups' && (activeRole === 'parent' || activeRole === 'admin') && <GroupManager groups={groups} token={token} impersonatingId={impersonatingUser?.id} apiFetch={apiFetch} refreshTrigger={() => setRefreshTrigger(p=>p+1)} />}
      {currentView === 'lists' && !impersonatingUser && (activeRole === 'admin' || activeRole === 'dietitian' || activeRole === 'parent') && <ListManager listItems={listItems} groups={groups} activeRole={activeRole} token={token} impersonatingId={impersonatingUser?.id} apiFetch={apiFetch} refreshTrigger={() => setRefreshTrigger(p=>p+1)} />}
      {currentView === 'admin' && !impersonatingUser && activeRole === 'admin' && <AdminPanel adminUsers={adminUsers} sysSettings={sysSettings} token={token} apiFetch={apiFetch} refreshTrigger={() => setRefreshTrigger(p=>p+1)} setImpersonatingUser={(u) => { setImpersonatingUser(u); setProfileName(u.name); setCurrentView('tracker'); }} />}

      {currentView === 'tracker' && (
        <>
          <div style={{ display: 'flex', gap: '15px', alignItems: 'center', marginBottom: '15px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', flexGrow: 1 }}>
                {groups.map(g => (
                    <button key={g.id} onClick={() => setVisibleGroupIds(prev => prev.includes(g.id) ? prev.filter(id => id !== g.id) : [...prev, g.id])} style={{ padding: '6px 12px', borderRadius: '20px', cursor: 'pointer', border: 'none', fontWeight: 'bold', fontSize: '14px', background: visibleGroupIds.includes(g.id) ? '#3b82f6' : '#e2e8f0', color: visibleGroupIds.includes(g.id) ? 'white' : '#64748b' }}>
                        {visibleGroupIds.includes(g.id) ? '✓ ' : '+ '} {g.name}
                    </button>
                ))}
            </div>
            
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <select value={filterMode} onChange={(e) => setFilterMode(e.target.value)} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f8fafc', fontWeight: 'bold', color: '#1e293b' }}>
                    <option value="ALL">🔍 Filter: Show All</option>
                    <option value="CHECKED">✅ Filter: Checked Only</option>
                    <option value="UNCHECKED">❌ Filter: Unchecked Only</option>
                </select>

                <select value={sortMode} onChange={(e) => setSortMode(e.target.value)} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f8fafc', fontWeight: 'bold', color: '#1e293b' }}>
                    <option value="A-Z">🔤 Sort: A-Z</option>
                    <option value="CHECKED_FIRST">✅ Sort: Checked First</option>
                    <option value="UNCHECKED_FIRST">❌ Sort: Unchecked First</option>
                </select>
            </div>

            <select value={selectedWeek || ''} onChange={(e) => setSelectedWeek(e.target.value)} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: 'white', fontWeight: 'bold' }}>
              {weeks.map((w, idx) => <option key={w.id} value={w.id}>{idx === 0 ? "Current Week" : "Week of " + w.week_start_date}</option>)}
            </select>
            <input type="text" placeholder="Search checklists..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="form-input" style={{ maxWidth: '200px' }}/>
          </div>
          <TrackerGrid groups={groups} visibleGroupIds={visibleGroupIds} gridData={gridData} setGridData={setGridData} listItems={listItems} searchTerm={searchTerm} filterMode={filterMode} sortMode={sortMode} effectiveUserId={effectiveUserId} activeRole={activeRole} impersonatingId={impersonatingUser?.id} selectedWeek={selectedWeek} apiFetch={apiFetch} token={token} />
        </>
      )}

      <div style={{ textAlign: 'center', fontSize: '12px', color: '#94a3b8', marginTop: '30px' }}>v{APP_VERSION}</div>
    </div>
  );
}
