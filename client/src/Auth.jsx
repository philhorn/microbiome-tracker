import React, { useState } from 'react';

export default function Auth({ setAuthData, setupNotice }) {
    const [isLoginView, setIsLoginView] = useState(true);
    const [username, setUsername] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [password, setPassword] = useState('');
    const [isParentReg, setIsParentReg] = useState(false);

    const authSubmit = async (e) => {
        e.preventDefault();
        const endpoint = isLoginView ? '/api/login' : '/api/register';
        const body = isLoginView ? { username, password } : { username, displayName, password, isParent: isParentReg };
        try {
            const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const data = await res.json();
            if (data.token) {
                setAuthData(data.token, data.role, data.name, data.username);
            } else if (!isLoginView && data.success) {
                setIsLoginView(true); alert("Registered! Please log in.");
            } else { alert(data.error); }
        } catch(err) { alert("Network Error"); }
    };

    return (
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
                {!isLoginView && <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}><input type="checkbox" checked={isParentReg} onChange={e => setIsParentReg(e.target.checked)}/> Manager Account</label>}
                <button type="submit" style={{ padding: '10px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>Submit</button>
            </form>
            <p style={{ cursor: 'pointer', color: '#2563eb', marginTop: '16px', textAlign: 'center' }} onClick={() => setIsLoginView(!isLoginView)}>{isLoginView ? "Need an account? Register" : "Have an account? Login"}</p>
        </div>
    );
}
