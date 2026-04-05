import React, { useState } from 'react';
import { auth, database } from '../firebase';
import { useNavigate } from 'react-router-dom';

function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // መግቢያ (Login Logic)
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const userCredential = await auth.signInWithEmailAndPassword(email, password);
      const user = userCredential.user;

      // ከዳታቤዝ የሥራ ድርሻውን (Role) ማረጋገጥ
      const snapshot = await database.ref(`Users/${user.uid}`).once("value");
      const userData = snapshot.val();

      if (userData) {
        // እንደ ስራ ድርሻው ወደ ተለያዩ ገጾች መላክ
        if (userData.role === "admin") navigate("/admin");
        else if (userData.role === "owner") navigate("/owner");
        else navigate("/user");
      }
    } catch (err) {
      alert("መግባት አልተቻለም፦ " + err.message);
    }
    setLoading(false);
  };

  // ምዝገባ (Sign Up Logic)
  const handleSignUp = async (e) => {
    e.preventDefault();
    if (!name) return alert("እባክዎ ሙሉ ስም ያስገቡ!");
    setLoading(true);
    try {
      const userCredential = await auth.createUserWithEmailAndPassword(email, password);
      const user = userCredential.user;
      
      await database.ref(`Users/${user.uid}`).set({
        name: name,
        email: email,
        role: role,
        createdAt: Date.now()
      });

      alert("ምዝገባ ተሳክቷል!");
      // ከተመዘገበ በኋላ በቀጥታ ወደ ሚመለከተው ገጽ ይውሰደው
      if (role === "admin") navigate("/admin");
      else if (role === "owner") navigate("/owner");
      else navigate("/user");

    } catch (err) {
      alert("ምዝገባ አልተሳካም፦ " + err.message);
    }
    setLoading(false);
  };

  return (
    <div className="container d-flex justify-content-center align-items-center vh-100 animate__animated animate__fadeIn">
      <div className="card p-4 shadow-lg border-0 bg-white" style={{ maxWidth: '420px', borderRadius: '20px', width: '100%' }}>
        
        <div className="text-center mb-4">
          <div className="bg-primary text-white d-inline-block p-3 rounded-circle mb-2 shadow-sm">
            <h2 className="m-0">🅿️</h2>
          </div>
          <h3 className="fw-bold text-dark">ENDERASE</h3>
          <p className="text-muted small fw-bold text-uppercase">{isLogin ? "መግቢያ" : "አዲስ አካውንት መፍጠሪያ"}</p>
        </div>

        <form onSubmit={isLogin ? handleLogin : handleSignUp}>
          {!isLogin && (
            <div className="mb-2">
              <label className="small fw-bold">ሙሉ ስም</label>
              <input type="text" className="form-control bg-light border-0 py-2" placeholder="ዮሐንስ ካሳ" required onChange={(e) => setName(e.target.value)} />
            </div>
          )}

          <div className="mb-2">
            <label className="small fw-bold">ኢሜይል</label>
            <input type="email" className="form-control bg-light border-0 py-2" placeholder="email@example.com" required onChange={(e) => setEmail(e.target.value)} />
          </div>

          <div className="mb-3">
            <label className="small fw-bold">የይለፍ ቃል</label>
            <input type="password" className="form-control bg-light border-0 py-2" placeholder="••••••••" required onChange={(e) => setPassword(e.target.value)} />
          </div>

          {!isLogin && (
            <div className="mb-4 p-2 border rounded bg-light shadow-sm">
              <label className="form-label small fw-bold mb-1">የስራ ድርሻ (Role):</label>
              <select className="form-select form-select-sm border-0 bg-transparent fw-bold text-primary" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="user">አሽከርካሪ (Driver)</option>
                <option value="owner">የፓርኪንግ ባለቤት (Owner)</option>
                <option value="admin">System Admin</option>
              </select>
            </div>
          )}

          <button type="submit" className="btn btn-primary w-100 py-2 fw-bold shadow-sm mb-3" disabled={loading} style={{ borderRadius: '10px' }}>
            {loading ? <span className="spinner-border spinner-border-sm"></span> : (isLogin ? "ግባ (Login)" : "ተመዝገብ")}
          </button>

          <div className="text-center border-top pt-3">
            <button type="button" className="btn btn-link btn-sm text-decoration-none fw-bold" onClick={() => setIsLogin(!isLogin)}>
              {isLogin ? "አዲስ አካውንት ፍጠር?" : "አካውንት አለዎት? ይግቡ"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default Auth;