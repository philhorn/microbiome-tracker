// --- SECTION 1: IMPORTS AND CONSTANTS ---
import React, { useState, useEffect } from 'react';

const categorizedFoods = {
  "Vegetables": ["Artichokes", "Arugula", "Asparagus", "Bamboo Shoots", "Beets", "Bell Peppers", "Bok Choy", "Broccoli", "Brussels Sprouts", "Cabbage", "Carrots", "Cauliflower", "Celery", "Collard Greens", "Cucumbers", "Dandelion Greens", "Eggplant", "Endive", "Fennel", "Garlic", "Green Beans", "Jerusalem Artichokes", "Jicama", "Kale", "Kohlrabi", "Leeks", "Mushrooms", "Mustard Greens", "Okra", "Olives", "Onions", "Parsnips", "Potatoes", "Pumpkin", "Radicchio", "Radishes", "Rutabaga", "Scallions", "Seaweed", "Shallots", "Spinach", "Sprouts", "Squash", "Sweet Potatoes", "Swiss Chard", "Tomatoes", "Turnips", "Watercress", "Zucchini"].sort(),
  "Fruits": ["Apples", "Apricots", "Avocado", "Bananas", "Blackberries", "Blueberries", "Cherries", "Cranberries", "Dates", "Figs", "Grapefruit", "Grapes", "Guava", "Kiwi", "Lemon", "Mango", "Melon", "Oranges", "Papaya", "Peaches", "Pears", "Pineapple", "Plums", "Pomegranate", "Raspberries", "Rhubarb", "Strawberries", "Watermelon"].sort(),
  "Nuts & Seeds": ["Almonds", "Cashews", "Chia Seeds", "Coconut", "Flaxseed", "Hazelnuts", "Hemp Seeds", "Macadamia Nuts", "Peanuts", "Pecans", "Pine Nuts", "Pistachios", "Pumpkin Seeds", "Sesame Seeds", "Sunflower Seeds", "Walnuts"].sort(),
  "Legumes": ["Black Beans", "Cannellini Beans", "Chickpeas", "Edamame", "Green Peas", "Lentils", "Lima Beans", "Navy Beans", "Pinto Beans", "Soybeans"].sort(),
  "Grains": ["Amaranth", "Barley", "Brown Rice", "Buckwheat", "Millet", "Oats", "Quinoa", "Rye", "Sorghum", "Teff", "Wild Rice"].sort(),
  "Herbs & Spices": ["Basil", "Cilantro", "Cinnamon", "Dill", "Ginger", "Mint", "Oregano", "Parsley", "Rosemary", "Sage", "Thyme", "Turmeric"].sort(),
  "Fermented & Other": ["Cocoa", "Kefir", "Kimchi", "Kombucha", "Miso", "Natto", "Olive Oil", "Red Wine", "Sauerkraut", "Tempeh", "Yogurt"].sort()
};

const columnColors = ['#f0f9ff', '#f0fdf4', '#fefce8', '#fff1f2', '#f3e8ff', '#ecfeff', '#fdf4ff'];
// --- END SECTION 1 ---

// --- SECTION 2: MAIN COMPONENT & STATE VARIABLES ---
export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [role, setRole] = useState(localStorage.getItem('role'));
  const [myLinkCode, setMyLinkCode] = useState(localStorage.getItem('linkCode'));
  const [myName, setMyName] = useState(localStorage.getItem('name') || '');
  const [myUsername, setMyUsername] = useState(localStorage.getItem('username') || '');
  
  const [currentView, setCurrentView] = useState('tracker'); 
  const [searchTerm, setSearchTerm] = useState('');
  
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [isParentReg, setIsParentReg] = useState(false);
  
  const [profileName, setProfileName] = useState(myName);
  const [profilePass, setProfilePass] = useState('');
  
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

  const [collapsedCats, setCollapsedCats] = useState({});
  const [undoMemory, setUndoMemory] = useState({});
  const [setupNotice, setSetupNotice] = useState(false);
  
  const [impersonatingId, setImpersonatingId] = useState(null);
  const [impersonatingName, setImpersonatingName] = useState(null);
  
  const [colWidths, setColWidths] = useState(() => {
      const saved = localStorage.getItem('colWidths');
      return saved ? JSON.parse(saved) : {};
  });
// --- END SECTION 2 ---

// --- SECTION 3: USE EFFECT HOOKS ---
  const hardReset = () => { localStorage.clear(); window.location.reload(); };

  const stopImpersonating = () => {
      setImpersonatingId(null);
      setImpersonatingName(null);
      setRefreshTrigger(p => p + 1);
  };

  useEffect(() => {
      localStorage.setItem('colWidths', JSON.stringify(colWidths));
  }, [colWidths]);

  useEffect(() => {
    fetch('/api/setup-status').then(r => r.json()).then(d => setSetupNotice(d.needsSetup)).catch(() => {});
  }, [isLoginView]);

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
    if (role === 'admin' && currentView === 'admin') {
      fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : hardReset())
        .then(d => setAdminUsers(Array.isArray(d) ? d : []))
        .catch(hardReset);
    } else {
      const url = impersonatingId ? `/api/family/grid?weekId=${selectedWeek}&impersonate=${impersonatingId}` : `/api/family/grid?weekId=${selectedWeek}`;
      fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : hardReset())
        .then(d => { if (d && !d.error) { setFamilyMembers(d.members || []); setGridData(d.grid || {}); } })
        .catch(hardReset);
    }
  }, [token, role, selectedWeek, currentView, refreshTrigger, impersonatingId]);
// --- END SECTION 3 ---

// --- SECTION 4: HELPER FUNCTIONS ---
  const authSubmit = async (e) => {
    e.preventDefault();
    const endpoint = isLoginView ? '/api/login' : '/api/register';
    const body = isLoginView ? { username, password } : { username, displayName, password, isParent: isParentReg };
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.token) {
        localStorage.setItem('token', data.token); localStorage.setItem('role', data.role); 
        localStorage.setItem('linkCode', data.link_code); localStorage.setItem('name', data.name); localStorage.setItem('username', data.username);
        setToken(data.token); setRole(data.role); setMyLinkCode(data.link_code); setMyName(data.name); setMyUsername(data.username); setProfileName(data.name);
      } else if (!isLoginView && data.success) {
        setIsLoginView(true); alert("Registered! Please log in.");
      } else { alert(data.error); }
    } catch(err) { alert("Network Error"); }
  };

  const updateProfile = async (e) => {
    e.preventDefault();
    const res = await fetch('/api/user/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ displayName: profileName, newPassword: profilePass || undefined }) });
    const data = await res.json();
    if (data.success) { localStorage.setItem('name', data.name); setMyName(data.name); setProfilePass(''); alert("Profile updated!"); setRefreshTrigger(p => p + 1); }
  };

  const handleUpgrade = async () => {
    if (!window.confirm("Convert this account to a Family Manager?")) return;
    const res = await fetch('/api/user/upgrade', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (data.success) { localStorage.setItem('token', data.token); localStorage.setItem('role', data.role); setToken(data.token); setRole(data.role); }
  };

  const handleDeleteSelf = async () => {
    if (!window.confirm("WARNING: This permanently deletes your account and data. Proceed?")) return;
    await fetch('/api/user/delete', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    hardReset();
  };

  const adminAction = async (id, action, payload) => {
    if (action === 'impersonate') {
        setImpersonatingId(id);
        setImpersonatingName(payload);
        setCurrentView('tracker');
        return;
    }
    const method = action === 'delete' ? 'DELETE' : 'POST';
    if (action === 'delete' && !window.confirm("Permanently delete this user?")) return;
    const body = payload ? JSON.stringify({ role: payload }) : null;
    const headers = { Authorization: `Bearer ${token}` };
    if (body) headers['Content-Type'] = 'application/json';
    await fetch(`/api/admin/${action}/${id}`, { method, headers, body });
    setRefreshTrigger(p => p + 1);
  };

  const createMember = async (e) => {
    e.preventDefault();
    const res = await fetch('/api/family/create', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ username: createUsername.trim(), displayName: createDisplayName.trim() || createUsername.trim(), password: createPassword }) });
    const data = await res.json();
    if (data.success) { setCreateUsername(''); setCreateDisplayName(''); setCreatePassword(''); setRefreshTrigger(p => p + 1); alert("Created!"); } else alert(data.error);
  };

  const linkUser = async (e) => {
    e.preventDefault();
    const res = await fetch('/api/family/link', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ username: linkUsername.trim(), linkCode: linkCodeInput.trim() }) });
    const data = await res.json();
    if (data.success) { setLinkUsername(''); setLinkCodeInput(''); setRefreshTrigger(p => p + 1); alert("Linked!"); } else alert(data.error);
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

  const handleCheckAll = async (item, action) => {
    const ids = familyMembers.map(m => m.id);
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
        await Promise.all(ids.map(id => fetch(`/api/toggle/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ item, checked: mem.includes(id), weekId: selectedWeek }) })));
    } else {
        await Promise.all(ids.map(id => fetch(`/api/toggle/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ item, checked: finalCheckState, weekId: selectedWeek }) })));
    }
  };

  const handleDrag = (e, colId, defaultWidth) => {
    const startX = e.clientX;
    const startWidth = colWidths[colId] || defaultWidth;
    
    const onMouseMove = (moveEvent) => {
        const newWidth = Math.max(80, startWidth + (moveEvent.clientX - startX));
        setColWidths(prev => ({ ...prev, [colId]: newWidth }));
    };
    
    const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    };
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };
// --- END SECTION 4 ---

// --- SECTION 5: RENDER - LOGIN/REGISTER SCREEN ---
  if (!token) return (
    <div style={{ maxWidth: '400px', margin: '50px auto', fontFamily: 'system-ui', padding: '24px', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
      {setupNotice && (
        <div style={{ background: '#fef3c7', padding: '12px', borderRadius: '6px', border: '1px solid #fcd34d', marginBottom: '20px', fontSize: '14px', color: '#92400e', lineHeight: '1.4' }}>
          <strong>System Initialized</strong><br/>
          A secure admin account has been created. Run this command on your server CLI to retrieve the temporary password:<br/>
          <code style={{ background: '#fde68a', padding: '4px', display: 'block', marginTop: '8px', borderRadius: '4px' }}>cat /var/www/microbiome-app/api/admin_credentials.txt</code>
        </div>
      )}
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
// --- END SECTION 5 ---

// --- SECTION 6: RENDER - MAIN APPLICATION UI ---
  const filteredCategories = Object.keys(categorizedFoods).reduce((acc, category) => {
    const filtered = categorizedFoods[category].filter(f => f.toLowerCase().includes(searchTerm.toLowerCase()));
    if (filtered.length > 0) acc[category] = filtered;
    return acc;
  }, {});

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
        .category-row { position: sticky; left: 0; z-index: 10; }
        
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
      
      {/* HEADER AND NAVIGATION */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '15px' }}>
        <div>
          <h2 style={{ margin: '0 0 4px 0' }}>Hi, {myName} <span style={{fontSize: '16px', color: '#64748b', fontWeight: 'normal'}}>({myUsername})</span></h2>
          
          {impersonatingId && (
            <div style={{ background: '#fef08a', padding: '6px 12px', borderRadius: '4px', display: 'inline-block', marginBottom: '8px', border: '1px solid #fde047', fontSize: '14px' }}>
                <strong>Impersonating:</strong> {impersonatingName} 
                <button onClick={stopImpersonating} style={{ marginLeft: '10px', padding: '2px 8px', background: '#eab308', border: 'none', borderRadius: '4px', cursor: 'pointer', color: 'white' }}>Exit</button>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button className={`nav-btn ${currentView === 'tracker' ? 'active' : ''}`} onClick={() => setCurrentView('tracker')}>Tracker</button>
            {(role === 'parent' || role === 'admin') && <button className={`nav-btn ${currentView === 'family' ? 'active' : ''}`} onClick={() => setCurrentView('family')}>Family Settings</button>}
            <button className={`nav-btn ${currentView === 'profile' ? 'active' : ''}`} onClick={() => setCurrentView('profile')}>Profile</button>
            <button className={`nav-btn ${currentView === 'about' ? 'active' : ''}`} onClick={() => setCurrentView('about')}>About</button>
            {role === 'admin' && <button className={`nav-btn ${currentView === 'admin' ? 'active' : ''}`} onClick={() => setCurrentView('admin')}>Admin</button>}
          </div>
        </div>
        <button onClick={hardReset} style={{ padding: '8px 16px', background: '#e2e8f0', color: '#334155', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Log Out</button>
      </div>

      {/* VIEW: ABOUT */}
      {currentView === 'about' && (
        <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0', lineHeight: '1.6' }}>
          <h3>The Goal: 30 Plant-Based Foods a Week</h3>
          <p>Scientific research indicates that eating 30 or more different plant-based foods each week significantly diversifies the gut microbiome.</p>
          <p>A healthy microbiome improves digestion, boosts the immune system, and contributes to overall well-being. This tracker helps monitor your weekly intake to hit that target (vegetables, fruits, nuts, seeds, legumes, and grains).</p>
          <p><em>Note: Eating the same food twice in a week only counts as 1 point toward diversity!</em></p>
        </div>
      )}

      {/* VIEW: PROFILE */}
      {currentView === 'profile' && (
        <div style={{ maxWidth: '600px' }}>
          <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '20px' }}>
            <h3 style={{ marginTop: 0 }}>Update Profile</h3>
            <form onSubmit={updateProfile} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label><strong>Display Name:</strong>
                <input type="text" value={profileName} onChange={e => setProfileName(e.target.value)} required className="form-input" style={{ width: '100%', marginTop: '4px' }}/>
              </label>
              <label><strong>New Password:</strong>
                <input type="password" placeholder="Leave blank to keep current password" value={profilePass} onChange={e => setProfilePass(e.target.value)} className="form-input" style={{ width: '100%', marginTop: '4px' }}/>
              </label>
              <button type="submit" className="form-btn" style={{ background: '#2563eb' }}>Save Changes</button>
            </form>
          </div>

          <div style={{ background: '#fee2e2', padding: '20px', borderRadius: '8px', border: '1px solid #fca5a5' }}>
            <h3 style={{ marginTop: 0, color: '#991b1b' }}>Danger Zone</h3>
            <div style={{ display: 'flex', gap: '10px' }}>
              {role === 'user' && <button onClick={handleUpgrade} style={{ padding: '8px 12px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Upgrade to Family Manager</button>}
              <button onClick={handleDeleteSelf} style={{ padding: '8px 12px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Delete My Account</button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW: FAMILY MANAGER */}
      {currentView === 'family' && (role === 'parent' || role === 'admin') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '800px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fef3c7', padding: '15px', borderRadius: '8px', border: '1px solid #fcd34d' }}>
            <span style={{ fontSize: '16px' }}>Your Family Connection PIN:</span>
            <strong style={{ fontSize: '24px', letterSpacing: '2px' }}>{myLinkCode}</strong>
          </div>
          <form onSubmit={createMember} className="form-group">
            <strong style={{ width: '100%' }}>Create & Add New Family Member:</strong>
            <input type="text" placeholder="Username (Login ID)" value={createUsername} onChange={e => setCreateUsername(e.target.value)} required className="form-input"/>
            <input type="text" placeholder="Display Name" value={createDisplayName} onChange={e => setCreateDisplayName(e.target.value)} className="form-input"/>
            <input type="password" placeholder="Password" value={createPassword} onChange={e => setCreatePassword(e.target.value)} required className="form-input"/>
            <button type="submit" className="form-btn" style={{ background: '#2563eb' }}>Create Account</button>
          </form>
          <form onSubmit={linkUser} className="form-group">
            <strong style={{ width: '100%' }}>Link Existing Account to Family:</strong>
            <input type="text" placeholder="Their Username" value={linkUsername} onChange={e => setLinkUsername(e.target.value)} required className="form-input"/>
            <input type="text" placeholder="Their 6-Digit PIN" value={linkCodeInput} onChange={e => setLinkCodeInput(e.target.value)} required className="form-input"/>
            <button type="submit" className="form-btn" style={{ background: '#10b981' }}>Connect Account</button>
          </form>
          
          <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <strong style={{ display: 'block', marginBottom: '10px' }}>Manage Family Order:</strong>
            {familyMembers.map((m, idx) => (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', borderBottom: '1px solid #cbd5e1', alignItems: 'center' }}>
                    <span>{m.name}</span>
                    <div>
                        <button onClick={() => shiftColumn(idx, -1)} style={{ padding: '4px 8px', marginRight: '4px', cursor: 'pointer' }}>Up</button>
                        <button onClick={() => shiftColumn(idx, 1)} style={{ padding: '4px 8px', cursor: 'pointer' }}>Down</button>
                    </div>
                </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW: SYSTEM ADMIN */}
      {currentView === 'admin' && role === 'admin' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', background: 'white', border: '1px solid #e2e8f0' }}>
            <thead><tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
              <th style={{ padding: '12px' }}>ID</th><th style={{ padding: '12px' }}>User</th><th style={{ padding: '12px' }}>Role</th><th style={{ padding: '12px' }}>Status</th><th style={{ padding: '12px' }}>Actions</th>
            </tr></thead>
            <tbody>{adminUsers.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid #e2e8f0', background: u.is_suspended ? '#fee2e2' : 'white' }}>
                <td style={{ padding: '12px' }}>{u.id}</td>
                <td style={{ padding: '12px' }}><strong>{u.display_name}</strong><br/><span style={{fontSize: '0.85em', color: '#64748b'}}>{u.username}</span></td>
                <td style={{ padding: '12px' }}>
                    <select value={u.role} onChange={(e) => adminAction(u.id, 'role', e.target.value)} disabled={u.id === 1} style={{ padding: '4px', borderRadius: '4px' }}>
                        <option value="user">User</option><option value="parent">Parent</option>
                        <option value="dietitian">Dietitian</option><option value="admin">Admin</option>
                    </select>
                </td>
                <td style={{ padding: '12px' }}>
                    {u.is_suspended ? 'Suspended' : (u.locked_until && new Date(u.locked_until) > new Date() ? 'Locked (Brute Force)' : 'Active')}
                </td>
                <td style={{ padding: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button onClick={() => adminAction(u.id, 'impersonate', u.display_name)} style={{ padding: '6px 10px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Impersonate</button>
                  <button onClick={() => adminAction(u.id, 'suspend')} disabled={u.id === 1} style={{ padding: '6px 10px', background: u.is_suspended ? '#10b981' : '#f59e0b', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                    {u.is_suspended ? 'Unsuspend' : 'Suspend'}
                  </button>
                  <button onClick={() => adminAction(u.id, 'delete')} disabled={u.id === 1} style={{ padding: '6px 10px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Delete</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {/* VIEW: MAIN TRACKER GRID */}
      {currentView === 'tracker' && (role !== 'admin' || familyMembers.length > 0 || impersonatingId) && (
        <>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '15px' }}>
            <select value={selectedWeek || ''} onChange={(e) => setSelectedWeek(e.target.value)} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: 'white', fontWeight: 'bold' }}>
              {weeks.map((w, idx) => <option key={w.id} value={w.id}>{idx === 0 ? "Current Week" : "Week of " + w.week_start_date}</option>)}
            </select>
            <input type="text" placeholder="Search foods..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="form-input" style={{ maxWidth: '300px' }}/>
          </div>
          
          <div style={{ maxHeight: '70vh', overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', background: 'white', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', textAlign: 'center' }}>
              <thead>
                <tr>
                  <th className="food-col cell-pad top-left-corner" style={{ width: colWidths['food'] || 160, minWidth: 120, maxWidth: colWidths['food'] || 160, borderBottom: '2px solid #cbd5e1', borderRight: '2px solid #cbd5e1', textAlign: 'left' }}>
                    Food Item
                    <div className="drag-handle" onMouseDown={(e) => handleDrag(e, 'food', 160)} />
                  </th>
                  {familyMembers.map((m, idx) => (
                    <th key={m.id} className="person-col cell-pad" style={{ width: colWidths[m.id] || 90, minWidth: 80, maxWidth: colWidths[m.id] || 90, background: columnColors[idx % columnColors.length], borderBottom: '2px solid #cbd5e1', borderRight: '1px solid #e2e8f0' }}>
                      <span style={{ fontWeight: 'bold' }}>{m.name}</span><br/>
                      <span style={{ fontSize: '0.85em', fontWeight: 'normal', color: '#64748b' }}>Score: {gridData[m.id]?.length || 0}</span>
                      <div className="drag-handle" onMouseDown={(e) => handleDrag(e, m.id, 90)} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.keys(filteredCategories).map(category => (
                  <React.Fragment key={category}>
                    <tr>
                      <td colSpan={familyMembers.length + 1} onClick={() => setCollapsedCats({...collapsedCats, [category]: !collapsedCats[category]})} className="category-row" style={{ background: '#e2e8f0', padding: '8px 12px', textAlign: 'left', fontWeight: 'bold', cursor: 'pointer' }}>
                        {collapsedCats[category] ? '▶' : '▼'} {category}
                      </td>
                    </tr>
                    {!collapsedCats[category] && filteredCategories[category].map(food => {
                      const checkedCount = familyMembers.filter(m => (gridData[m.id] || []).includes(food)).length;
                      let allBtnText = "All";
                      let action = 'all';
                      let btnColor = '#cbd5e1';
                      let hoverTitle = "Check everyone";

                      if (checkedCount === familyMembers.length) {
                          if (undoMemory[food]) { 
                              allBtnText = "Revert"; 
                              action = 'revert'; 
                              btnColor = '#fde047';
                              hoverTitle = "Undo 'All' and restore previous checks";
                          } else { 
                              allBtnText = "Clear"; 
                              action = 'clear'; 
                              btnColor = '#fca5a5';
                              hoverTitle = "Uncheck everyone";
                          }
                      }

                      return (
                      <tr key={food}>
                        <td className="food-col cell-pad" style={{ borderBottom: '1px solid #f1f5f9', borderRight: '2px solid #cbd5e1', textAlign: 'left', fontWeight: '500', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>{food}</span>
                          {(role === 'parent' || impersonatingId) && (
                              <button 
                                onClick={() => handleCheckAll(food, action)} 
                                title={hoverTitle}
                                style={{ fontSize: '12px', padding: '4px 8px', background: btnColor, border: 'none', borderRadius: '4px', cursor: 'pointer', minWidth: '45px' }}
                              >
                                {allBtnText}
                              </button>
                          )}
                        </td>
                        {familyMembers.map((m, idx) => (
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
        </>
      )}
    </div>
  );
}
// --- END SECTION 6 ---