import React, { useState } from "react";
import { Link } from "react-router-dom";
import { auth, firestore } from "../firebase";

function Signup() {
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (e) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    const { fullName, email, password, confirmPassword } = formData;

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const userCredential = await auth.createUserWithEmailAndPassword(email, password);
      const user = userCredential.user;

      await firestore.collection("users").doc(user.uid).set({
        fullName,
        email,
        phone: "",
        role: "driver",
        status: "active",
        ownerId: null,
        assignedParkingIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // Route changes are handled in App.js by auth + role state.
    } catch (err) {
      if (err.code === "auth/email-already-in-use") {
        setError("This email is already in use.");
      } else if (err.code === "auth/invalid-email") {
        setError("Please enter a valid email address.");
      } else if (err.code === "auth/weak-password") {
        setError("Password is too weak.");
      } else if (err.code === "auth/operation-not-allowed") {
        setError("Email/password signup is not enabled in Firebase Authentication.");
      } else {
        setError(`Signup failed: ${err.message}`);
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
          <h2 className="fw-bold text-primary">Create Driver Account</h2>
          <p className="text-muted small text-uppercase fw-bold">ENDERASE Smart Parking</p>
        </div>

        {error && <div className="alert alert-danger py-2 small text-center rounded-3">{error}</div>}

        <form onSubmit={handleSignup}>
          <div className="mb-2">
            <label className="form-label small fw-bold">Full Name</label>
            <input
              type="text"
              name="fullName"
              className="form-control bg-light border-0 py-2"
              placeholder="John Doe"
              autoComplete="name"
              required
              onChange={handleChange}
            />
          </div>

          <div className="mb-2">
            <label className="form-label small fw-bold">Email</label>
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

          <div className="row g-2 mb-3">
            <div className="col-6">
              <label className="small fw-bold">Password</label>
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
              <label className="small fw-bold">Confirm</label>
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

          <button
            type="submit"
            className="btn btn-primary w-100 py-2 fw-bold shadow-sm d-flex align-items-center justify-content-center gap-2"
            disabled={loading}
            style={{ borderRadius: "12px" }}
          >
            <span
              className="spinner-border spinner-border-sm"
              style={{ visibility: loading ? "visible" : "hidden" }}
              aria-hidden={!loading}
            ></span>
            <span>{loading ? "Creating account..." : "Create Account"}</span>
          </button>
        </form>

        <div className="text-center mt-4 border-top pt-3">
          <p className="small text-muted mb-0">
            Already have an account?{" "}
            <Link to="/login" className="text-primary fw-bold text-decoration-none">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Signup;
