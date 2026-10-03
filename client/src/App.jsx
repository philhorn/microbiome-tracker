import React, { useState, useEffect } from 'react';

const defaultFoods = ["Almonds", "Amaranth", "Apples", "Apricots", "Artichokes", "Arugula", "Asparagus", "Avocado", "Bamboo Shoots", "Bananas", "Barley", "Beets", "Bell Peppers", "Black Beans", "Blackberries", "Blueberries", "Bok Choy", "Broccoli", "Brussels Sprouts", "Buckwheat", "Cabbage", "Cannellini Beans", "Carrots", "Cashews", "Cauliflower", "Celery", "Chia Seeds", "Chickpeas", "Cilantro", "Cocoa", "Coconut", "Collard Greens", "Cranberries", "Cucumbers", "Dandelion Greens", "Dates", "Edamame", "Eggplant", "Endive", "Fennel", "Flaxseed", "Garlic", "Ginger", "Grapefruit", "Grapes", "Green Beans", "Green Peas", "Guava", "Hazelnuts", "Hemp Seeds", "Jerusalem Artichokes", "Jicama", "Kale", "Kefir", "Kimchi", "Kiwi", "Kohlrabi", "Kombucha", "Leeks", "Lemon", "Lentils", "Lima Beans", "Macadamia Nuts", "Mango", "Millet", "Mint", "Miso", "Mushrooms", "Mustard Greens", "Natto", "Navy Beans", "Oats", "Okra", "Olive Oil", "Olives", "Onions", "Oranges", "Papaya", "Parsley", "Parsnips", "Peaches", "Pears", "Pecans", "Pine Nuts", "Pineapple", "Pinto Beans", "Pistachios", "Plums", "Pomegranate", "Potatoes", "Pumpkin", "Pumpkin Seeds", "Quinoa", "Radicchio", "Radishes", "Raspberries", "Red Wine", "Rhubarb", "Rutabaga", "Rye", "Sauerkraut", "Scallions", "Seaweed", "Sesame Seeds", "Shallots", "Sorghum", "Soybeans", "Spinach", "Sprouts", "Squash", "Strawberries", "Sunflower Seeds", "Sweet Potatoes", "Swiss Chard", "Teff", "Tempeh", "Tomatoes", "Turnips", "Walnuts", "Watermelon", "Wild Rice", "Yogurt", "Zucchini"];
const columnColors = ['#f0f9ff', '#f0fdf4', '#fefce8', '#fff1f2', '#f3e8ff', '#ecfeff', '#fdf4ff'];

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [role, setRole] = useState(localStorage.getItem('role'));
  const [myLinkCode, setMyLinkCode] = useState(localStorage.getItem('linkCode'));
  
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [isParentReg, setIsParentReg] = useState(false);
  
  const [createUsername, setCreateUsername] = useState('');
  const [createDisplayName, setCreateDisplayName] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [linkUsername, setLinkUsername] = useState('');
  const [linkCodeInput, setLinkCodeInput] = useState('');
  
  const [weeks, setWeeks] = useState([]);
  const [selectedWeek, setSelectedWeek] = useState(null);
  
  const [familyMembers, setFamilyMembers] = useState([]);
  const [gridData, setGridData] = useState({});
  const [adminUsers, setAdminUsers] = useState([]);
  const [isLoginView, setIsLoginView] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const hardReset = () => { localStorage.clear(); window.location.reload(); };

  useEffect(() => {
    if (token) {
        fetch('/api/weeks', { headers: { Authorization: `Bearer ${token}` } })
            .then(r => { if (!r.ok) { hardReset(); throw new Error('Auth failed'); } return r.json(); })
            .then(data => { setWeeks(data); if (data.length > 0 && !selectedWeek) setSelectedWeek(data[0].id); })
            .catch(() => {});
    }
  }, [token]);

  useEffect(() => {
    if (!token || !selectedWeek) return;
    if (role === 'admin') {
      fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : hardReset())
        .then(d => setAdminUsers(Array.isArray(d) ? d : []))
        .catch(hardReset);
    } else {
      fetch(`/api/family/grid?weekId=${selectedWeek}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : hardReset())
        .then(d => { if (d && !d.error) { setFamilyMembers(d.members || []); setGridData(d.grid || {}); } })
        .catch(hardReset);
    }
  }, [token, role, selectedWeek, refreshTrigger]);

  const authSubmit = async (e) => {
    e.preventDefault();
    const endpoint = isLoginView ? '/api/login' : '/api/register';
    const body = isLoginView ? { username, password } : { username, displayName, password, isParent: isParentReg };
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.token) {
        localStorage.setItem('token', data.token); localStorage.setItem('role', data.role); localStorage.setItem('linkCode', data.link_code);
        setToken(data.token); setRole(data.role); setMyLinkCode(data.link_code);
      } else if (!isLoginView && data.success) {
        setIsLoginView(true); alert("Registered! Please log in.");
      } else { alert(data.error); }
    } catch(err) { alert("Network Error"); }
  };

  const handleUpgrade = async () => {
    if (!window.confirm("Convert this account to a Family Manager?")) return;
    const res = await fetch('/api/user/upgrade', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (data.success) {
      localStorage.setItem('token', data.token); localStorage.setItem('role', data.role);
      setToken(data.token); setRole(data.role);
    }
  };

  const handleDeleteSelf = async () => {
    if (!window.confirm("WARNING: This permanently deletes your account and data. Proceed?")) return;
    await fetch('/api/user/delete', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    hardReset();
  };

  const adminAction = async (id, action) => {
    const method = action === 'suspend' ? 'POST' : 'DELETE';
    if (action === 'delete' && !window.confirm("Permanently delete this user?")) return;
    await fetch(`/api/admin/${action}/${id}`, { method, headers: { Authorization: `Bearer ${token}` } });
    setRefreshTrigger(p => p + 1);
  };

  const createMember = async (e) => {
    e.preventDefault();
    if (!createUsername.trim() || !createPassword.trim()) return;
    const res = await fetch('/api/family/create', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ username: createUsername.trim(), displayName: createDisplayName.trim() || createUsername.trim(), password: createPassword }) });
    const data = await res.json();
    if (data.success) { setCreateUsername(''); setCreateDisplayName(''); setCreatePassword(''); setRefreshTrigger(p => p + 1); } 
    else alert(data.error);
  };

  const linkUser = async (e) => {
    e.preventDefault();
    if (!linkUsername.trim() || !linkCodeInput.trim()) return;
    const res = await fetch('/api/family/link', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ username: linkUsername.trim(), linkCode: linkCodeInput.trim() }) });
    const data = await res.json();
    if (data.success) { setLinkUsername(''); setLinkCodeInput(''); setRefreshTrigger(p => p + 1); } 
    else alert(data.error);
  };

  const shiftColumn = async (index, direction) => {
    const newArr = [...familyMembers];
    if (direction === -1 && index > 0) [newArr[index - 1], newArr[index]] = [newArr[index], newArr[index - 1]];
    else if (direction === 1 && index < newArr.length - 1) [newArr[index + 1], newArr[index]] = [newArr[index], newArr[index + 1]];
    else return;
    setFamilyMembers(newArr);
    await fetch('/api/family/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ order: newArr.map(m => m.id) }) });
  };

  const handleToggle = async (memberId, item) => {
    const isChecked = gridData[memberId]?.includes(item);
    setGridData(prev => ({ ...prev, [memberId]: isChecked ? (prev[memberId] || []).filter(i => i !== item) : [...(prev[memberId] || []), item] }));
    await fetch(`/api/toggle/${memberId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ item, checked: !isChecked, weekId: selectedWeek }) });
  };

  if (!token) return (
    <div style={{ maxWidth: '400px', margin: '50px auto', fontFamily: 'system-ui', padding: '24px', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
      <h2 style={{ marginTop: 0 }}>{isLoginView ? "Login" : "Register"}</h2>
      <form onSubmit={authSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <input type="text" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} required style={{ padding: '10px', borderRadius: '4px', border: '1px solid #cbd5e1' }}/>
        {!isLoginView && <input type="text" placeholder="Display Name" value={displayName} onChange={e => setDisplayName(e.target.value)} required style={{ padding: '10px', borderRadius: '4px', border: '1px solid #cbd5e1' }}/>}
        <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required style={{ padding: '10px', borderRadius: '4px', border: '1px solid #cbd5e1' }}/>
        {!isLoginView && <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}><input type="checkbox" checked={isParentReg} onChange={e => setIsParentReg(e.target.checked)}/> Manager Account (Parent)</label>}
        <button type="submit" style={{ padding: '10px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>Submit</button>
      </form>
      <p style={{ cursor: 'pointer', color: '#2563eb', marginTop: '16px', textAlign: 'center' }} onClick={() => setIsLoginView(!isLoginView)}>{isLoginView ? "Need an account? Register" : "Have an account? Login"}</p>
    </div>
  );

  const HeaderControls = () => (
    <div style={{ marginBottom: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
        <div>
          <h2 style={{ margin: '0 0 8px 0' }}>Microbiome Diversity Tracker</h2>
          <div style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
            {myLinkCode && <span style={{ background: '#fef3c7', padding: '4px 8px', borderRadius: '4px', fontSize: '14px', border: '1px solid #fcd34d' }}><strong>Connection PIN:</strong> {myLinkCode}</span>}
            <select value={selectedWeek || ''} onChange={(e) => setSelectedWeek(e.target.value)} style={{ padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e1', background: 'white', fontWeight: 'bold' }}>
              {weeks.map((w, idx) => <option key={w.id} value={w.id}>{idx === 0 ? "Current Week" : "Week of " + w.week_start_date}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          {role === 'user' && <button onClick={handleUpgrade} style={{ padding: '6px 12px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Upgrade to Manager</button>}
          <button onClick={handleDeleteSelf} style={{ padding: '6px 12px', background: '#f87171', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Delete Account</button>
          <button onClick={hardReset} style={{ padding: '6px 12px', background: '#64748b', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Logout</button>
        </div>
      </div>
    </div>
  );

  if (role === 'admin') return (
    <div style={{ fontFamily: 'system-ui', maxWidth: '1000px', margin: '0 auto', padding: '20px' }}>
      <HeaderControls />
      <h3>Admin Panel - User Management</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px', textAlign: 'left', background: 'white', border: '1px solid #e2e8f0' }}>
        <thead><tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
          <th style={{ padding: '12px' }}>ID</th><th style={{ padding: '12px' }}>Display Name (Username)</th><th style={{ padding: '12px' }}>Role</th><th style={{ padding: '12px' }}>Status</th><th style={{ padding: '12px' }}>Actions</th>
        </tr></thead>
        <tbody>{adminUsers.map(u => (
          <tr key={u.id} style={{ borderBottom: '1px solid #e2e8f0', background: u.is_suspended ? '#fee2e2' : 'white' }}>
            <td style={{ padding: '12px' }}>{u.id}</td>
            <td style={{ padding: '12px' }}><strong>{u.display_name}</strong> ({u.username})</td>
            <td style={{ padding: '12px' }}>{u.role}</td>
            <td style={{ padding: '12px' }}>{u.is_suspended ? 'Suspended' : 'Active'}</td>
            <td style={{ padding: '12px', display: 'flex', gap: '8px' }}>
              <button onClick={() => adminAction(u.id, 'suspend')} style={{ padding: '4px 8px', background: u.is_suspended ? '#10b981' : '#f59e0b', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                {u.is_suspended ? 'Unsuspend' : 'Suspend'}
              </button>
              <button onClick={() => adminAction(u.id, 'delete')} style={{ padding: '4px 8px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Delete</button>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );

  return (
    <div style={{ fontFamily: 'system-ui', maxWidth: '1200px', margin: '0 auto', padding: '20px' }}>
      <HeaderControls />
      
      {role === 'parent' && (
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '20px' }}>
          <form onSubmit={createMember} style={{ display: 'flex', gap: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '15px', borderRadius: '8px', flexGrow: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <strong style={{ width: '100%' }}>Create & Link Account:</strong>
            <input type="text" placeholder="Username" value={createUsername} onChange={e => setCreateUsername(e.target.value)} required style={{ padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', width: '120px' }}/>
            <input type="text" placeholder="Display Name" value={createDisplayName} onChange={e => setCreateDisplayName(e.target.value)} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', width: '120px' }}/>
            <input type="password" placeholder="Password" value={createPassword} onChange={e => setCreatePassword(e.target.value)} required style={{ padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', width: '120px' }}/>
            <button type="submit" style={{ padding: '8px 16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>Create</button>
          </form>

          <form onSubmit={linkUser} style={{ display: 'flex', gap: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '15px', borderRadius: '8px', flexGrow: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <strong style={{ width: '100%' }}>Link Existing Account:</strong>
            <input type="text" placeholder="Username" value={linkUsername} onChange={e => setLinkUsername(e.target.value)} required style={{ padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', width: '120px' }}/>
            <input type="text" placeholder="6-Digit PIN" value={linkCodeInput} onChange={e => setLinkCodeInput(e.target.value)} required style={{ padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', width: '90px' }}/>
            <button type="submit" style={{ padding: '8px 16px', background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>Connect</button>
          </form>
        </div>
      )}

      <div style={{ maxHeight: '75vh', overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', background: 'white' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', textAlign: 'center' }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0, top: 0, background: '#f8fafc', padding: '12px', borderBottom: '2px solid #cbd5e1', borderRight: '2px solid #cbd5e1', textAlign: 'left', zIndex: 30, minWidth: '180px' }}>Food Item</th>
              {familyMembers.map((m, idx) => (
                <th key={m.id} style={{ 
                  position: 'sticky', top: 0, background: columnColors[idx % columnColors.length], padding: '12px', 
                  borderBottom: '2px solid #cbd5e1', borderRight: '1px solid #e2e8f0', zIndex: 20, 
                  minWidth: '130px', maxWidth: '300px', resize: 'horizontal', overflow: 'hidden' 
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    {role === 'parent' ? <button onClick={() => shiftColumn(idx, -1)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8' }}>&lt;</button> : <span></span>}
                    <span style={{ fontWeight: 'bold' }}>{m.name}</span>
                    {role === 'parent' ? <button onClick={() => shiftColumn(idx, 1)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8' }}>&gt;</button> : <span></span>}
                  </div>
                  <span style={{ fontSize: '0.85em', fontWeight: 'normal', color: '#64748b' }}>Score: {gridData[m.id]?.length || 0}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {defaultFoods.map(food => (
              <tr key={food}>
                <td style={{ position: 'sticky', left: 0, background: 'white', padding: '10px 12px', borderBottom: '1px solid #f1f5f9', borderRight: '2px solid #cbd5e1', textAlign: 'left', zIndex: 10, fontWeight: '500' }}>{food}</td>
                {familyMembers.map((m, idx) => (
                  <td key={m.id} onClick={() => handleToggle(m.id, food)} style={{ padding: '10px', background: columnColors[idx % columnColors.length], borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #e2e8f0', cursor: 'pointer' }}>
                    <input type="checkbox" checked={gridData[m.id]?.includes(food) || false} readOnly style={{ width: '22px', height: '22px', pointerEvents: 'none' }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}