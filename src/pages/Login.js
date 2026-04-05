import React, { useState } from "react";
import { auth } from "../firebase";
import { useNavigate } from "react-router-dom";


function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(""); // ስህተቶችን ለተጠቃሚው ለማሳየት

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(""); // የቀድሞ ስህተትን አጽዳ

    try {
      await auth.signInWithEmailAndPassword(email, password);
      // እዚህ ጋር Navigate ማድረግ አያስፈልግም፣ 
      // ምክንያቱም App.js ላይ ያለው onAuthStateChanged በራሱ ይቀይረዋል።       
    } catch (error) {
      console.error(error.code);
      // ስህተቶችን ወደ አማርኛ መቀየር
      if (error.code === "auth/wrong-password") {
        setErrorMsg("የተሳሳተ የይለፍ ቃል ተጠቅመዋል።");
      } else if (error.code === "auth/user-not-found") {
        setErrorMsg("በዚህ ኢሜይል የተመዘገበ አካውንት የለም።");
      } else {
        setErrorMsg("ለመግባት ሲሞከር ስህተት ተፈጥሯል፤ እባክዎ እንደገና ይሞክሩ።");
      }
    }
    setLoading(false);
  };

  return (
    <div className="container d-flex justify-content-center align-items-center vh-100 animate__animated animate__fadeIn">
      <div className="card shadow-lg border-0 p-4 w-100" style={{ maxWidth: "400px", borderRadius: "25px", backgroundColor: "#ffffff" }}>
        
        <div className="text-center mb-4">
          <div className="bg-primary text-white d-inline-block p-3 rounded-circle mb-3 shadow-sm" style={{ width: "80px", height: "80px" }}>
            <h1 className="m-0" style={{ fontSize: "40px" }}>🚗</h1>
          </div>
          <h2 className="fw-bold text-dark mb-0">ENDERASE</h2>
          <p className="text-primary small fw-bold text-uppercase tracking-widest">Smart Parking System</p>
        </div>

        {/* ስህተት ካለ እዚህ ጋር ይታያል */}
        {errorMsg && (
          <div className="alert alert-danger py-2 small text-center rounded-3 animate__animated animate__shakeX">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div className="mb-3">
            <label className="form-label small fw-bold text-muted">ኢሜይል (Email)</label>
            <input
              type="email"
              className="form-control form-control-lg border-0 bg-light"
              placeholder="example@mail.com"
              required
              style={{ borderRadius: "12px", fontSize: "16px" }}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="mb-4">
            <label className="form-label small fw-bold text-muted">የይለፍ ቃል (Password)</label>
            <input
              type="password"
              className="form-control form-control-lg border-0 bg-light"
              placeholder="••••••••"
              required
              style={{ borderRadius: "12px", fontSize: "16px" }}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg w-100 fw-bold shadow mb-3"
            disabled={loading}
            style={{ borderRadius: "12px", padding: "12px" }}
          >
            {loading ? (
              <span className="spinner-border spinner-border-sm me-2"></span>
            ) : null}
            {loading ? "በመግባት ላይ..." : "ግባ (Login)"}
          </button>
        </form>

        <div className="text-center mt-3">
          <p className="small text-muted mb-1">አካውንት የለዎትም?</p>
          <button 
            className="btn btn-link text-primary fw-bold text-decoration-none p-0" 
            onClick={() => alert("አዲስ አካውንት ለመክፈት እባክዎ ሲስተም አድሚኑን በ +251... ያነጋግሩ!")}
          >
            አድሚኑን ይጠይቁ
          </button>
        </div>
      </div>
    </div>
  );
}

export default Login;