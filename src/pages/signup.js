import React, { useState } from "react";
import { auth, database } from "../firebase";
import { useNavigate, Link } from "react-router-dom";

const ALLOWED_SIGNUP_ROLES = ["user", "owner"];

function Signup() {
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "user", // default role as Driver
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    const { fullName, email, password, confirmPassword, role } = formData;

    // 1. መሠረታዊ ማረጋገጫዎች (Validations)
    if (password !== confirmPassword) {
      return setError("የይለፍ ቃሎቹ አይመሳሰሉም!");
    }
    if (password.length < 6) {
      return setError("የይለፍ ቃል ቢያንስ 6 ፊደላት መሆን አለበት!");
    }
    if (!ALLOWED_SIGNUP_ROLES.includes(role)) {
      return setError("ይህን የስራ ድርሻ መመዝገብ አይፈቀድም።");
    }

    setLoading(true);
    setError("");

    try {
      // 2. በFirebase Auth አካውንት መፍጠር
      const userCredential = await auth.createUserWithEmailAndPassword(email, password);
      const user = userCredential.user;

      // 3. የተጠቃሚውን ዝርዝር መረጃ በDatabase ውስጥ ማስቀመጥ
      await database.ref(`Users/${user.uid}`).set({
        name: fullName,
        email: email,
        role: role, // 'user', 'owner', ወይም 'operator'
        createdAt: Date.now(),
      });

      alert("ምዝገባው ተሳክቷል! እንኳን ወደ ENDERASE በደህና መጡ።");
      
      // 4. እንደ ስራ ድርሻቸው ወደ ሚመለከተው ገጽ መውሰድ
      if (role === "owner") navigate("/owner");
      else navigate("/user");

    } catch (err) {
      // ስህተቶችን ወደ አማርኛ መቀየር
      if (err.code === "auth/email-already-in-use") {
        setError("ይህ ኢሜይል ቀድሞ ተመዝግቧል።");
      } else if (err.code === "auth/operation-not-allowed") {
        setError("Email/Password signup በ Firebase Authentication ላይ አልተከፈተም።");
      } else if (err.code === "auth/invalid-api-key") {
        setError("የ Firebase API Key ልክ አይደለም። የ .env ቅንብርን ያረጋግጡ።");
      } else if (err.code === "auth/app-not-authorized") {
        setError("ይህ domain በ Firebase Authentication Authorized domains ውስጥ የለም።");
      } else {
        setError("ምዝገባ አልተሳካም፦ " + err.message);
      }
      console.error("Signup failed:", err.code, err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container d-flex justify-content-center align-items-center min-vh-100 animate__animated animate__fadeIn">
      <div className="card p-4 shadow-lg border-0" style={{ maxWidth: "450px", width: "100%", borderRadius: "25px" }}>
        
        <div className="text-center mb-4">
          <h2 className="fw-bold text-primary">አዲስ አካውንት መፍጠሪያ</h2>
          <p className="text-muted small text-uppercase fw-bold">ENDERASE Smart Parking</p>
        </div>

        {error && <div className="alert alert-danger py-2 small text-center rounded-3">{error}</div>}

        <form onSubmit={handleSignup}>
          <div className="mb-2">
            <label className="form-label small fw-bold">ሙሉ ስም</label>
            <input
              type="text"
              name="fullName"
              className="form-control bg-light border-0 py-2"
              placeholder="ዮሐንስ ካሳ"
              autoComplete="name"
              required
              onChange={handleChange}
            />
          </div>

          <div className="mb-2">
            <label className="form-label small fw-bold">ኢሜይል</label>
            <input
              type="email"
              name="email"
              className="form-control bg-light border-0 py-2"
              placeholder="example@mail.com"
              autoComplete="email"
              required
              onChange={handleChange}
            />
          </div>

          <div className="mb-2">
            <label className="form-label small fw-bold">የስራ ድርሻ (Role)</label>
            <select name="role" className="form-select bg-light border-0 py-2 fw-bold text-primary" onChange={handleChange} value={formData.role}>
              <option value="user">አሽከርካሪ (Driver)</option>
              <option value="owner">የፓርኪንግ ባለቤት (Owner)</option>
            </select>
          </div>

          <div className="row g-2 mb-3">
            <div className="col-6">
              <label className="small fw-bold">የይለፍ ቃል</label>
              <input
                type="password"
                name="password"
                className="form-control bg-light border-0 py-2"
                placeholder="••••••"
                autoComplete="new-password"
                required
                onChange={handleChange}
              />
            </div>
            <div className="col-6">
              <label className="small fw-bold">ድጋሚ አረጋግጥ</label>
              <input
                type="password"
                name="confirmPassword"
                className="form-control bg-light border-0 py-2"
                placeholder="••••••"
                autoComplete="new-password"
                required
                onChange={handleChange}
              />
            </div>
          </div>

          <button type="submit" className="btn btn-primary w-100 py-2 fw-bold shadow-sm d-flex align-items-center justify-content-center gap-2" disabled={loading} style={{ borderRadius: "12px" }}>
            <span
              className="spinner-border spinner-border-sm"
              style={{ visibility: loading ? "visible" : "hidden" }}
              aria-hidden={!loading}
            ></span>
            <span>{loading ? "በመመዝገብ ላይ..." : "አካውንት ፍጠር"}</span>
          </button>
        </form>

        <div className="text-center mt-4 border-top pt-3">
          <p className="small text-muted mb-0">አካውንት አለዎት? <Link to="/login" className="text-primary fw-bold text-decoration-none">ይግቡ</Link></p>
        </div>
      </div>
    </div>
  );
}

export default Signup;
