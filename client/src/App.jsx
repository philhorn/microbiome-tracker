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

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [role, setRole] = useState(localStorage.getItem('role'));
  const [myLinkCode, setMyLinkCode] = useState(localStorage.getItem('linkCode'));
  const [myName, setMyName] = useState(localStorage.getItem('name') || '');
  
  const [currentView, setCurrentView] = useState('tracker'); // tracker, about, profile
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
        localStorage.setItem('token', data.token); localStorage.setItem('role', data.role); 
        localStorage.setItem('linkCode', data.link_code); localStorage.setItem('name', data.name);
        setToken(data.token); setRole(data.role); setMyLinkCode(data.link_code); setMyName(data.name); setProfileName(data.name);
      } else if (!isLoginView && data.success) {
        setIsLoginView(true); alert("Registered! Please log in.");
      } else { alert(data.error); }
    } catch(err) { alert("Network Error"); }
  };

  const updateProfile = async (e) => {
    e.preventDefault();
    const res = await fetch('/api/user/profile', { 
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ displayName: profileName, newPassword: profilePass || undefined })
    });
    const data = await res.json();
    if (data.success) {
        localStorage.setItem('name', data.name); setMyName(data.name); setProfilePass('');
        alert("Profile updated successfully!"); setRefreshTrigger(p => p + 1);
    }
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

  const handleToggle = async (memberId, item) => {
    const isChecked = gridData[memberId]?.includes(item);
    setGridData(prev => ({ ...prev, [memberId]: isChecked ? (prev[memberId] || []).filter(i => i !== item) : [...(prev[memberId] || []), item] }));
    await fetch(`/api/toggle/${memberId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ item, checked: !isChecked, weekId: selectedWeek }) });
  };

  const handleCheckAll = async (item) => {
    const ids = familyMembers.map(m => m.id);
    const someUnchecked = ids.some(id => !(gridData[id] || []).includes(item));
    const isChecking = someUnchecked; // If any are missing, check them all. If all present, uncheck all.
    
    setGridData(prev => {
        const next = { ...prev };
        ids.forEach(id => {
            if (!next[id]) next[id] = [];
            if (isChecking && !next[id].includes(item)) next[id].push(item);
            else if (!isChecking) next[id] = next[id].filter(i => i !== item);
        });
        return next;
    });
    // Fire API for all family members asynchronously
    await Promise.all(ids.map(id => 
        fetch(`/api/toggle/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ item, checked: isChecking, weekId: selectedWeek }) })
    ));
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
        .food-col { min-width: 220px; position: sticky; left: 0; z-index: 30; background: white; }
        .person-col { min-width: 130px; position: sticky; top: 0; z-index: 20; resize: horizontal; overflow: hidden; }
        .cell-pad { padding: 10px 12px; }

        @media (max-width: 768px) {
          .app-container { padding: 10px; }
          .header-actions { width: 100%; }
          .form-group { flex-direction: column; align-items: stretch; }
          .form-input { flex: 1 1 100%; width: 100%; box-sizing: border-box; }
          .food-col { min-width: 160px; font-size: 14px; }
          .person-col { min-width: 90px; font-size: 14px; }
          .cell-pad { padding: 8px 6px; font-size: 14px; }
          .person-controls button { padding: 2px 6px; }
        }
      `}</style>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '15px' }}>
        <div>
          <h2 style={{ margin: '0 0 8px 0' }}>Hi, {myName}</h2>
          <div style={{ display: 'flex', gap: '15px' }}>
            <button className={`nav-btn ${currentView === 'tracker' ? 'active' : ''}`} onClick={() => setCurrentView('tracker')}>Tracker</button>
            <button className={`nav-btn ${currentView === 'profile' ? 'active' : ''}`} onClick={() => setCurrentView('profile')}>Profile</button>
            <button className={`nav-btn ${currentView === 'about' ? 'active' : ''}`} onClick={() => setCurrentView('about')}>About</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={hardReset} style={{ padding: '8px 16px', background: '#e2e8f0', color: '#334155', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Log Out</button>
        </div>
      </div>

      {currentView === 'about' && (
        <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0', lineHeight: '1.6' }}>
          <h3>The Goal: 30 Plant-Based Foods a Week</h3>
          <p>Scientific research indicates that people who eat 30 or more different plant-based foods each week have significantly more diverse and robust gut microbiomes compared to those who eat 10 or fewer.</p>
          <p>A healthy microbiome improves digestion, boosts the immune system, and contributes to overall well-being. This tracker helps you and your family monitor your weekly intake to hit that target of 30 unique plants (vegetables, fruits, nuts, seeds, legumes, and grains) every week.</p>
          <p><em>Note: Eating the same food twice in a week only counts as 1 point toward diversity!</em></p>
        </div>
      )}

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
            <p style={{ color: '#991b1b' }}>These actions are permanent and cannot be undone.</p>
            <div style={{ display: 'flex', gap: '10px' }}>
              {role === 'user' && <button onClick={handleUpgrade} style={{ padding: '8px 12px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Upgrade to Manager</button>}
              <button onClick={handleDeleteSelf} style={{ padding: '8px 12px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Delete My Account</button>
            </div>
          </div>
        </div>
      )}

      {currentView === 'tracker' && role !== 'admin' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px', marginBottom: '15px' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexGrow: 1 }}>
              <select value={selectedWeek || ''} onChange={(e) => setSelectedWeek(e.target.value)} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: 'white', fontWeight: 'bold' }}>
                {weeks.map((w, idx) => <option key={w.id} value={w.id}>{idx === 0 ? "Current Week" : "Week of " + w.week_start_date}</option>)}
              </select>
              <input type="text" placeholder="Search foods..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="form-input" style={{ maxWidth: '300px' }}/>
            </div>
            {myLinkCode && <span style={{ background: '#fef3c7', padding: '6px 10px', borderRadius: '4px', fontSize: '14px', border: '1px solid #fcd34d' }}><strong>Family PIN:</strong> {myLinkCode}</span>}
          </div>
          
          <div style={{ maxHeight: '70vh', overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', background: 'white', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', textAlign: 'center' }}>
              <thead>
                <tr>
                  <th className="food-col cell-pad" style={{ top: 0, background: '#f8fafc', borderBottom: '2px solid #cbd5e1', borderRight: '2px solid #cbd5e1', textAlign: 'left' }}>Food Item</th>
                  {familyMembers.map((m, idx) => (
                    <th key={m.id} className="person-col cell-pad" style={{ background: columnColors[idx % columnColors.length], borderBottom: '2px solid #cbd5e1', borderRight: '1px solid #e2e8f0' }}>
                      <div className="person-controls" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 'bold' }}>{m.name}</span>
                      </div>
                      <span style={{ fontSize: '0.85em', fontWeight: 'normal', color: '#64748b' }}>Score: {gridData[m.id]?.length || 0}/30</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.keys(filteredCategories).map(category => (
                  <React.Fragment key={category}>
                    <tr>
                      <td colSpan={familyMembers.length + 1} style={{ background: '#e2e8f0', padding: '8px 12px', textAlign: 'left', fontWeight: 'bold', position: 'sticky', left: 0, zIndex: 10 }}>
                        {category}
                      </td>
                    </tr>
                    {filteredCategories[category].map(food => (
                      <tr key={food}>
                        <td className="food-col cell-pad" style={{ borderBottom: '1px solid #f1f5f9', borderRight: '2px solid #cbd5e1', textAlign: 'left', fontWeight: '500', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>{food}</span>
                          {role === 'parent' && <button onClick={() => handleCheckAll(food)} style={{ fontSize: '12px', padding: '2px 6px', background: '#cbd5e1', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>All</button>}
                        </td>
                        {familyMembers.map((m, idx) => (
                          <td key={m.id} className="cell-pad" onClick={() => handleToggle(m.id, food)} style={{ background: columnColors[idx % columnColors.length], borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #e2e8f0', cursor: 'pointer' }}>
                            <input type="checkbox" checked={gridData[m.id]?.includes(food) || false} readOnly style={{ width: '22px', height: '22px', pointerEvents: 'none' }} />
                          </td>
                        ))}
                      </tr>
                    ))}
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